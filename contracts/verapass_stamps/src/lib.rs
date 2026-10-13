//! verapass_stamps - proof-of-presence registry and stamps for Verapass.
//!
//! Roles:
//! - admin: manages roles, the creator and place registry, and contract upgrades.
//! - attestor: the Verapass server key. It activates a traveller's passport
//!   (on their first on-chain stamp) and mints a stamp after a check-in passed
//!   the off-chain checks (GPS geofence, server nonce, time window).
//!
//! The contract enforces the trust rules: only an active verified creator can
//! own a place, only the attestor can mint, a traveller needs an active
//! passport, one stamp per traveller per place, and stamps never move.
//!
//! Only hashes and ids are stored. No names, coordinates or other personal data.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN,
    ContractExecutable, Env, IntoVal, String, Val, Vec,
};

/// Contract interface version, bumped on every upgrade that changes behaviour.
pub const VERSION: u32 = 1;

/// Longest allowed place id, in bytes. Ids in shared/places.ts are kebab-case slugs.
pub const MAX_PLACE_ID_LEN: u32 = 32;

/// A check-in may be stamped at most this long after it happened (24 hours).
pub const MAX_STAMP_AGE_SECS: u64 = 24 * 60 * 60;

/// Allowed clock skew between the attestor and the ledger (5 minutes).
pub const MAX_CLOCK_SKEW_SECS: u64 = 5 * 60;

// TTL policy, in ledgers (about 5 seconds each).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No pending admin proposal to accept.
    NoPendingAdmin = 1,
    CreatorAlreadyRegistered = 2,
    CreatorNotFound = 3,
    CreatorRevoked = 4,
    PlaceAlreadyRegistered = 5,
    PlaceNotFound = 6,
    /// Place id is empty, longer than 32 bytes, or not [a-z0-9-].
    InvalidPlaceId = 7,
    PassportNotActive = 8,
    /// The traveller already has a passport with a different payment reference.
    PassportAlreadyActive = 9,
    AlreadyStamped = 10,
    /// Check-in timestamp is in the future or older than 24 hours.
    InvalidTimestamp = 11,
    /// Stamps are non-transferable. transfer, transfer_from and approve always fail.
    NonTransferable = 12,
    StampNotFound = 13,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatorRecord {
    /// sha256 of the off-chain verification record (for the pilot: TAT licence check).
    pub licence_hash: BytesN<32>,
    pub active: bool,
    pub added_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlaceRecord {
    pub creator: Address,
    /// Commitment to the check-in point and radius:
    /// sha256("verapass-geo-v1|<id>|<lat>|<lng>|<radiusM>|<salt_hex>"), computed by
    /// contracts/scripts/place-commitments.ts. The raw coordinates and the salt stay off-chain.
    pub geo_commitment: BytesN<32>,
    pub visits: u32,
    pub added_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StampRecord {
    pub token_id: u32,
    /// sha256 of the server-side check-in receipt (nonce, geofence result, time).
    pub receipt_hash: BytesN<32>,
    /// Check-in time (unix seconds) as reported by the attestor.
    pub checked_in_at: u64,
    /// Ledger time when the stamp was minted.
    pub stamped_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenRecord {
    pub owner: Address,
    pub place_id: String,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // instance storage
    Admin,
    PendingAdmin,
    Attestor,
    NextTokenId,
    // persistent storage
    Creator(Address),
    Place(String),
    Passport(Address),
    Stamp(Address, String),
    StampsOf(Address),
    Token(u32),
}

// Events. The first field marked #[topic] is indexed after the event name.

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatorAdded {
    #[topic]
    pub creator: Address,
    pub licence_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatorRevoked {
    #[topic]
    pub creator: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlaceAdded {
    #[topic]
    pub place_id: String,
    pub creator: Address,
    pub geo_commitment: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PassportActivated {
    #[topic]
    pub traveller: Address,
    pub payment_ref: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stamped {
    #[topic]
    pub traveller: Address,
    #[topic]
    pub place_id: String,
    pub token_id: u32,
    pub receipt_hash: BytesN<32>,
    pub checked_in_at: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestorChanged {
    pub attestor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    pub pending_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}

#[contract]
pub struct VerapassStamps;

#[contractimpl]
impl VerapassStamps {
    /// Runs once at deploy time.
    pub fn __constructor(env: Env, admin: Address, attestor: Address) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Attestor, &attestor);
        s.set(&DataKey::NextTokenId, &1u32);
        bump_instance(&env);
    }

    // Roles and upgrades (admin)

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn attestor(env: Env) -> Address {
        read_attestor(&env)
    }

    pub fn version() -> u32 {
        VERSION
    }

    /// Rotate the attestor key (for example after a server key leak).
    pub fn set_attestor(env: Env, attestor: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Attestor, &attestor);
        AttestorChanged { attestor }.publish(&env);
    }

    /// Step 1 of a two-step admin handover. The new admin must call accept_admin.
    pub fn propose_admin(env: Env, pending_admin: Address) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &pending_admin);
        AdminProposed { pending_admin }.publish(&env);
    }

    /// Step 2 of the admin handover, signed by the proposed admin.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let s = env.storage().instance();
        let pending: Address = s.get(&DataKey::PendingAdmin).ok_or(Error::NoPendingAdmin)?;
        pending.require_auth();
        s.set(&DataKey::Admin, &pending);
        s.remove(&DataKey::PendingAdmin);
        bump_instance(&env);
        AdminChanged { admin: pending }.publish(&env);
        Ok(())
    }

    /// Replace the contract code. Storage and the contract id are kept.
    /// The wasm must be uploaded first (stellar contract upload).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_admin(&env);
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(new_wasm_hash.clone()));
        Upgraded {
            wasm_hash: new_wasm_hash,
        }
        .publish(&env);
    }

    // Creator and place registry (admin)

    pub fn add_creator(env: Env, creator: Address, licence_hash: BytesN<32>) -> Result<(), Error> {
        require_admin(&env);
        let key = DataKey::Creator(creator.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::CreatorAlreadyRegistered);
        }
        let record = CreatorRecord {
            licence_hash: licence_hash.clone(),
            active: true,
            added_at: env.ledger().timestamp(),
        };
        set_persistent(&env, &key, &record);
        CreatorAdded {
            creator,
            licence_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Revoke a creator. Their places stop accepting new stamps. Existing
    /// stamps stay, because those visits did happen.
    pub fn revoke_creator(env: Env, creator: Address) -> Result<(), Error> {
        require_admin(&env);
        let mut record = read_creator(&env, &creator)?;
        if !record.active {
            return Err(Error::CreatorRevoked);
        }
        record.active = false;
        set_persistent(&env, &DataKey::Creator(creator.clone()), &record);
        CreatorRevoked { creator }.publish(&env);
        Ok(())
    }

    pub fn add_place(
        env: Env,
        place_id: String,
        creator: Address,
        geo_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        require_admin(&env);
        validate_place_id(&place_id)?;
        if !read_creator(&env, &creator)?.active {
            return Err(Error::CreatorRevoked);
        }
        let key = DataKey::Place(place_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::PlaceAlreadyRegistered);
        }
        let record = PlaceRecord {
            creator: creator.clone(),
            geo_commitment: geo_commitment.clone(),
            visits: 0,
            added_at: env.ledger().timestamp(),
        };
        set_persistent(&env, &key, &record);
        PlaceAdded {
            place_id,
            creator,
            geo_commitment,
        }
        .publish(&env);
        Ok(())
    }

    // Traveller flow (attestor)

    /// Called by the attestor before a traveller's first stamp. The server sets
    /// payment_ref = sha256(checkout_session_id) for a paid pass, or a
    /// free-passport ref when there is no payment (server/attestor.ts paymentRef).
    /// The contract does not check the payment. Repeating the call with the same
    /// payment_ref is a no-op, so retries are safe.
    pub fn activate_passport(
        env: Env,
        traveller: Address,
        payment_ref: BytesN<32>,
    ) -> Result<(), Error> {
        require_attestor(&env);
        let key = DataKey::Passport(traveller.clone());
        if let Some(existing) = env.storage().persistent().get::<_, BytesN<32>>(&key) {
            return if existing == payment_ref {
                Ok(())
            } else {
                Err(Error::PassportAlreadyActive)
            };
        }
        set_persistent(&env, &key, &payment_ref);
        PassportActivated {
            traveller,
            payment_ref,
        }
        .publish(&env);
        Ok(())
    }

    /// Mint a non-transferable stamp after a check-in passed the server checks
    /// (geofence, nonce, time window). ts is the check-in time in unix seconds.
    /// Returns the new token id.
    pub fn stamp(
        env: Env,
        traveller: Address,
        place_id: String,
        checkin_receipt_hash: BytesN<32>,
        ts: u64,
    ) -> Result<u32, Error> {
        require_attestor(&env);

        let now = env.ledger().timestamp();
        if ts > now.saturating_add(MAX_CLOCK_SKEW_SECS)
            || now.saturating_sub(ts) > MAX_STAMP_AGE_SECS
        {
            return Err(Error::InvalidTimestamp);
        }

        let mut place = read_place(&env, &place_id)?;
        if !read_creator(&env, &place.creator)?.active {
            return Err(Error::CreatorRevoked);
        }
        let persistent = env.storage().persistent();
        if !persistent.has(&DataKey::Passport(traveller.clone())) {
            return Err(Error::PassportNotActive);
        }
        let stamp_key = DataKey::Stamp(traveller.clone(), place_id.clone());
        if persistent.has(&stamp_key) {
            return Err(Error::AlreadyStamped);
        }

        let instance = env.storage().instance();
        let token_id: u32 = instance.get(&DataKey::NextTokenId).unwrap_or(1);
        instance.set(&DataKey::NextTokenId, &(token_id + 1));

        let record = StampRecord {
            token_id,
            receipt_hash: checkin_receipt_hash.clone(),
            checked_in_at: ts,
            stamped_at: now,
        };
        set_persistent(&env, &stamp_key, &record);

        let list_key = DataKey::StampsOf(traveller.clone());
        let mut list: Vec<String> = persistent.get(&list_key).unwrap_or_else(|| Vec::new(&env));
        list.push_back(place_id.clone());
        set_persistent(&env, &list_key, &list);

        set_persistent(
            &env,
            &DataKey::Token(token_id),
            &TokenRecord {
                owner: traveller.clone(),
                place_id: place_id.clone(),
            },
        );

        place.visits += 1;
        set_persistent(&env, &DataKey::Place(place_id.clone()), &place);

        Stamped {
            traveller,
            place_id,
            token_id,
            receipt_hash: checkin_receipt_hash,
            checked_in_at: ts,
        }
        .publish(&env);
        Ok(token_id)
    }

    // Reads

    pub fn has_stamp(env: Env, traveller: Address, place_id: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Stamp(traveller, place_id))
    }

    pub fn get_stamp(env: Env, traveller: Address, place_id: String) -> Option<StampRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Stamp(traveller, place_id))
    }

    /// Place ids the traveller has stamps for, in stamping order.
    pub fn stamps_of(env: Env, traveller: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::StampsOf(traveller))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// "Validated by N real visitors".
    pub fn place_visit_count(env: Env, place_id: String) -> Result<u32, Error> {
        Ok(read_place(&env, &place_id)?.visits)
    }

    pub fn get_place(env: Env, place_id: String) -> Option<PlaceRecord> {
        env.storage().persistent().get(&DataKey::Place(place_id))
    }

    pub fn creator_of(env: Env, place_id: String) -> Result<Address, Error> {
        Ok(read_place(&env, &place_id)?.creator)
    }

    pub fn get_creator(env: Env, creator: Address) -> Option<CreatorRecord> {
        env.storage().persistent().get(&DataKey::Creator(creator))
    }

    pub fn is_creator_active(env: Env, creator: Address) -> bool {
        read_creator(&env, &creator)
            .map(|c| c.active)
            .unwrap_or(false)
    }

    pub fn is_passport_active(env: Env, traveller: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Passport(traveller))
    }

    // SEP-50 style read names, so wallets and explorers can show stamps

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Verapass Stamps")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "VPSTAMP")
    }

    pub fn balance(env: Env, owner: Address) -> u32 {
        Self::stamps_of(env, owner).len()
    }

    pub fn owner_of(env: Env, token_id: u32) -> Result<Address, Error> {
        Ok(read_token(&env, token_id)?.owner)
    }

    pub fn token_place(env: Env, token_id: u32) -> Result<String, Error> {
        Ok(read_token(&env, token_id)?.place_id)
    }

    /// Always fails: a stamp proves its owner was there, so it cannot move.
    pub fn transfer(_from: Address, _to: Address, _token_id: u32) -> Result<(), Error> {
        Err(Error::NonTransferable)
    }

    /// Always fails, see transfer.
    pub fn transfer_from(
        _spender: Address,
        _from: Address,
        _to: Address,
        _token_id: u32,
    ) -> Result<(), Error> {
        Err(Error::NonTransferable)
    }

    /// Always fails, see transfer.
    pub fn approve(
        _approver: Address,
        _approved: Address,
        _token_id: u32,
        _live_until_ledger: u32,
    ) -> Result<(), Error> {
        Err(Error::NonTransferable)
    }
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

fn set_persistent<V>(env: &Env, key: &DataKey, value: &V)
where
    V: IntoVal<Env, Val>,
{
    let p = env.storage().persistent();
    p.set(key, value);
    p.extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// Admin and attestor are set by the constructor, so these keys always exist.
fn read_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn read_attestor(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Attestor).unwrap()
}

fn require_admin(env: &Env) {
    read_admin(env).require_auth();
    bump_instance(env);
}

fn require_attestor(env: &Env) {
    read_attestor(env).require_auth();
    bump_instance(env);
}

fn read_creator(env: &Env, creator: &Address) -> Result<CreatorRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Creator(creator.clone()))
        .ok_or(Error::CreatorNotFound)
}

fn read_place(env: &Env, place_id: &String) -> Result<PlaceRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Place(place_id.clone()))
        .ok_or(Error::PlaceNotFound)
}

fn read_token(env: &Env, token_id: u32) -> Result<TokenRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Token(token_id))
        .ok_or(Error::StampNotFound)
}

/// Place ids are kebab-case slugs: 1 to 32 bytes of [a-z0-9-].
fn validate_place_id(place_id: &String) -> Result<(), Error> {
    let len = place_id.len();
    if len == 0 || len > MAX_PLACE_ID_LEN {
        return Err(Error::InvalidPlaceId);
    }
    let mut buf = [0u8; MAX_PLACE_ID_LEN as usize];
    let bytes = &mut buf[..len as usize];
    place_id.copy_into_slice(bytes);
    if bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    {
        Ok(())
    } else {
        Err(Error::InvalidPlaceId)
    }
}

#[cfg(test)]
mod test;
