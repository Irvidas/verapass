extern crate std;

use super::*;
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
    MockAuthInvoke,
};
use soroban_sdk::{vec, Event as _, IntoVal, Symbol};

const NOW: u64 = 1_790_000_000;

struct Setup<'a> {
    env: Env,
    client: VerapassStampsClient<'a>,
    admin: Address,
    attestor: Address,
    creator: Address,
    traveller: Address,
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// Contract with one active creator, one place ("wat-chalong") and one
/// traveller with an active passport. All auths are mocked.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let attestor = Address::generate(&env);
    let creator = Address::generate(&env);
    let traveller = Address::generate(&env);
    let id = env.register(VerapassStamps, (&admin, &attestor));
    let client = VerapassStampsClient::new(&env, &id);

    env.mock_all_auths();
    client.add_creator(&creator, &hash(&env, 1));
    client.add_place(&s(&env, "wat-chalong"), &creator, &hash(&env, 2));
    client.activate_passport(&traveller, &hash(&env, 3));

    Setup {
        env,
        client,
        admin,
        attestor,
        creator,
        traveller,
    }
}

/// Same contract, but with no auth mocks: every require_auth fails.
fn setup_no_auth<'a>() -> Setup<'a> {
    let st = setup();
    st.env.set_auths(&[]);
    st
}

fn assert_contract_err<T: core::fmt::Debug, E: core::fmt::Debug>(
    res: Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected: Error,
) {
    match res {
        Err(Ok(e)) => assert_eq!(e, expected),
        other => panic!("expected {expected:?}, got {other:?}"),
    }
}

/// Auth failure on a function that returns Result<_, Error>.
fn assert_auth_err<T: core::fmt::Debug, E: core::fmt::Debug>(
    res: Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
) {
    match res {
        Err(Err(_)) => {}
        other => panic!("expected an auth failure, got {other:?}"),
    }
}

/// Auth failure on a function without a contract error type. The host
/// reports the failed require_auth as Error(Context, InvalidAction).
fn assert_untyped_auth_err<T: core::fmt::Debug, E: core::fmt::Debug>(
    res: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    let expected = soroban_sdk::Error::from_type_and_code(
        soroban_sdk::xdr::ScErrorType::Context,
        soroban_sdk::xdr::ScErrorCode::InvalidAction,
    );
    match res {
        Err(Ok(e)) if e == expected => {}
        Err(Err(_)) => {}
        other => panic!("expected an auth failure, got {other:?}"),
    }
}

// ---- constructor and metadata ----

#[test]
fn constructor_sets_roles_and_metadata() {
    let st = setup();
    assert_eq!(st.client.admin(), st.admin);
    assert_eq!(st.client.attestor(), st.attestor);
    assert_eq!(st.client.version(), VERSION);
    assert_eq!(st.client.name(), s(&st.env, "Verapass Stamps"));
    assert_eq!(st.client.symbol(), s(&st.env, "VPSTAMP"));
}

// ---- happy path ----

#[test]
fn stamp_mints_and_updates_reads() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");

    assert!(!st.client.has_stamp(&st.traveller, &place));
    assert_eq!(st.client.place_visit_count(&place), 0);
    assert_eq!(st.client.balance(&st.traveller), 0);

    let token = st
        .client
        .stamp(&st.traveller, &place, &hash(env, 9), &(NOW - 60));
    assert_eq!(token, 1);

    assert!(st.client.has_stamp(&st.traveller, &place));
    assert_eq!(st.client.stamps_of(&st.traveller), vec![env, place.clone()]);
    assert_eq!(st.client.place_visit_count(&place), 1);
    assert_eq!(st.client.balance(&st.traveller), 1);
    assert_eq!(st.client.owner_of(&token), st.traveller);
    assert_eq!(st.client.token_place(&token), place);
    assert_eq!(st.client.creator_of(&place), st.creator);
    assert_eq!(
        st.client.get_stamp(&st.traveller, &place),
        Some(StampRecord {
            token_id: 1,
            receipt_hash: hash(env, 9),
            checked_in_at: NOW - 60,
            stamped_at: NOW,
        })
    );
}

#[test]
fn stamp_requires_attestor_signature_only() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    st.client.stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_eq!(
        env.auths(),
        std::vec![(
            st.attestor.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    st.client.address.clone(),
                    Symbol::new(env, "stamp"),
                    (st.traveller.clone(), place, hash(env, 9), NOW).into_val(env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn stamp_emits_event() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    st.client.stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    let expected = Stamped {
        traveller: st.traveller.clone(),
        place_id: place,
        token_id: 1,
        receipt_hash: hash(env, 9),
        checked_in_at: NOW,
    };
    assert_eq!(
        env.events().all(),
        std::vec![expected.to_xdr(env, &st.client.address)]
    );
}

#[test]
fn counts_across_travellers_and_places() {
    let st = setup();
    let env = &st.env;
    let wat = s(env, "wat-chalong");
    let cape = s(env, "promthep-cape");
    st.client.add_place(&cape, &st.creator, &hash(env, 4));

    let other = Address::generate(env);
    st.client.activate_passport(&other, &hash(env, 5));

    assert_eq!(
        st.client.stamp(&st.traveller, &wat, &hash(env, 10), &NOW),
        1
    );
    assert_eq!(
        st.client.stamp(&st.traveller, &cape, &hash(env, 11), &NOW),
        2
    );
    assert_eq!(st.client.stamp(&other, &wat, &hash(env, 12), &NOW), 3);

    assert_eq!(st.client.place_visit_count(&wat), 2);
    assert_eq!(st.client.place_visit_count(&cape), 1);
    assert_eq!(st.client.balance(&st.traveller), 2);
    assert_eq!(st.client.balance(&other), 1);
    assert_eq!(
        st.client.stamps_of(&st.traveller),
        vec![env, wat.clone(), cape.clone()]
    );
    assert_eq!(st.client.owner_of(&3), other);
}

// ---- duplicates ----

#[test]
fn duplicate_stamp_is_rejected_and_count_unchanged() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    st.client.stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_contract_err(
        st.client
            .try_stamp(&st.traveller, &place, &hash(env, 10), &NOW),
        Error::AlreadyStamped,
    );
    assert_eq!(st.client.place_visit_count(&place), 1);
    assert_eq!(st.client.balance(&st.traveller), 1);
}

#[test]
fn duplicate_creator_and_place_are_rejected() {
    let st = setup();
    let env = &st.env;
    assert_contract_err(
        st.client.try_add_creator(&st.creator, &hash(env, 7)),
        Error::CreatorAlreadyRegistered,
    );
    assert_contract_err(
        st.client
            .try_add_place(&s(env, "wat-chalong"), &st.creator, &hash(env, 7)),
        Error::PlaceAlreadyRegistered,
    );
}

#[test]
fn passport_activation_is_idempotent_per_payment_ref() {
    let st = setup();
    let env = &st.env;
    // same ref again (webhook retry): no error, no new event
    st.client.activate_passport(&st.traveller, &hash(env, 3));
    assert_eq!(env.events().all().events().len(), 0);
    assert_contract_err(
        st.client
            .try_activate_passport(&st.traveller, &hash(env, 99)),
        Error::PassportAlreadyActive,
    );
    assert!(st.client.is_passport_active(&st.traveller));
}

// ---- revocation ----

#[test]
fn revoked_creator_blocks_new_stamps_and_places_but_keeps_history() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    st.client.stamp(&st.traveller, &place, &hash(env, 9), &NOW);

    assert!(st.client.is_creator_active(&st.creator));
    st.client.revoke_creator(&st.creator);
    assert!(!st.client.is_creator_active(&st.creator));
    assert!(!st.client.get_creator(&st.creator).unwrap().active);

    let other = Address::generate(env);
    st.client.activate_passport(&other, &hash(env, 5));
    assert_contract_err(
        st.client.try_stamp(&other, &place, &hash(env, 10), &NOW),
        Error::CreatorRevoked,
    );
    assert_contract_err(
        st.client
            .try_add_place(&s(env, "kata-viewpoint"), &st.creator, &hash(env, 6)),
        Error::CreatorRevoked,
    );
    assert_contract_err(
        st.client.try_revoke_creator(&st.creator),
        Error::CreatorRevoked,
    );

    // history stays
    assert!(st.client.has_stamp(&st.traveller, &place));
    assert_eq!(st.client.place_visit_count(&place), 1);
}

#[test]
fn revoke_unknown_creator_fails() {
    let st = setup();
    let env = &st.env;
    assert_contract_err(
        st.client.try_revoke_creator(&Address::generate(env)),
        Error::CreatorNotFound,
    );
}

// ---- validation ----

#[test]
fn stamp_validation_errors() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");

    assert_contract_err(
        st.client
            .try_stamp(&st.traveller, &s(env, "atlantis"), &hash(env, 9), &NOW),
        Error::PlaceNotFound,
    );
    assert_contract_err(
        st.client
            .try_stamp(&Address::generate(env), &place, &hash(env, 9), &NOW),
        Error::PassportNotActive,
    );
    assert_contract_err(
        st.client.try_stamp(
            &st.traveller,
            &place,
            &hash(env, 9),
            &(NOW + MAX_CLOCK_SKEW_SECS + 1),
        ),
        Error::InvalidTimestamp,
    );
    assert_contract_err(
        st.client.try_stamp(
            &st.traveller,
            &place,
            &hash(env, 9),
            &(NOW - MAX_STAMP_AGE_SECS - 1),
        ),
        Error::InvalidTimestamp,
    );
    // edges are accepted
    st.client.stamp(
        &st.traveller,
        &place,
        &hash(env, 9),
        &(NOW + MAX_CLOCK_SKEW_SECS),
    );
}

#[test]
fn place_id_validation() {
    let st = setup();
    let env = &st.env;
    for bad in [
        "",
        "Wat-Chalong",
        "wat chalong",
        "wat_chalong",
        "a-very-long-place-id-that-is-too-long",
    ] {
        assert_contract_err(
            st.client
                .try_add_place(&s(env, bad), &st.creator, &hash(env, 2)),
            Error::InvalidPlaceId,
        );
    }
    let exactly_32 = "abcdefghijklmnopqrstuvwxyz-01234";
    assert_eq!(exactly_32.len(), 32);
    st.client
        .add_place(&s(env, exactly_32), &st.creator, &hash(env, 2));
}

#[test]
fn add_place_requires_registered_creator() {
    let st = setup();
    let env = &st.env;
    assert_contract_err(
        st.client.try_add_place(
            &s(env, "big-buddha"),
            &Address::generate(env),
            &hash(env, 2),
        ),
        Error::CreatorNotFound,
    );
}

#[test]
fn unknown_reads() {
    let st = setup();
    let env = &st.env;
    assert_contract_err(
        st.client.try_place_visit_count(&s(env, "nowhere")),
        Error::PlaceNotFound,
    );
    assert_contract_err(
        st.client.try_creator_of(&s(env, "nowhere")),
        Error::PlaceNotFound,
    );
    assert_contract_err(st.client.try_owner_of(&42), Error::StampNotFound);
    assert_eq!(st.client.get_place(&s(env, "nowhere")), None);
    assert_eq!(st.client.get_creator(&Address::generate(env)), None);
    assert!(!st.client.is_creator_active(&Address::generate(env)));
    assert_eq!(st.client.stamps_of(&Address::generate(env)).len(), 0);
}

// ---- non-transferable ----

#[test]
fn stamps_cannot_move() {
    let st = setup();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    let token = st.client.stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    let buyer = Address::generate(env);
    assert_contract_err(
        st.client.try_transfer(&st.traveller, &buyer, &token),
        Error::NonTransferable,
    );
    assert_contract_err(
        st.client
            .try_transfer_from(&buyer, &st.traveller, &buyer, &token),
        Error::NonTransferable,
    );
    assert_contract_err(
        st.client.try_approve(&st.traveller, &buyer, &token, &1000),
        Error::NonTransferable,
    );
    assert_eq!(st.client.owner_of(&token), st.traveller);
}

// ---- auth failures ----

#[test]
fn registry_and_attestor_calls_fail_without_signatures() {
    let st = setup_no_auth();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    let someone = Address::generate(env);

    assert_auth_err(st.client.try_add_creator(&someone, &hash(env, 1)));
    assert_auth_err(st.client.try_revoke_creator(&st.creator));
    assert_auth_err(
        st.client
            .try_add_place(&s(env, "big-buddha"), &st.creator, &hash(env, 2)),
    );
    assert_auth_err(st.client.try_activate_passport(&someone, &hash(env, 3)));
    assert_auth_err(
        st.client
            .try_stamp(&st.traveller, &place, &hash(env, 9), &NOW),
    );
    assert_untyped_auth_err(st.client.try_set_attestor(&someone));
    assert_untyped_auth_err(st.client.try_propose_admin(&someone));
    assert_untyped_auth_err(st.client.try_upgrade(&hash(env, 0)));

    // nothing changed
    assert!(!st.client.has_stamp(&st.traveller, &place));
    assert_eq!(st.client.attestor(), st.attestor);
}

#[test]
fn admin_cannot_stamp_and_attestor_cannot_manage_registry() {
    let st = setup_no_auth();
    let env = &st.env;
    let place = s(env, "wat-chalong");
    let args = (st.traveller.clone(), place.clone(), hash(env, 9), NOW);

    // admin signs a stamp call: rejected, only the attestor may mint
    let res = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.admin,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "stamp",
                args: args.clone().into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_auth_err(res);

    // traveller signs their own stamp: also rejected
    let res = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.traveller,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "stamp",
                args: args.clone().into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_auth_err(res);

    // attestor signs add_creator: rejected, registry is admin-only
    let someone = Address::generate(env);
    let res = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.attestor,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "add_creator",
                args: (someone.clone(), hash(env, 1)).into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_add_creator(&someone, &hash(env, 1));
    assert_auth_err(res);

    // attestor signs the stamp: accepted
    let token = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.attestor,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "stamp",
                args: args.into_val(env),
                sub_invokes: &[],
            },
        }])
        .stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_eq!(token, 1);
}

// ---- role management ----

#[test]
fn attestor_rotation() {
    let st = setup();
    let env = &st.env;
    let new_attestor = Address::generate(env);
    st.client.set_attestor(&new_attestor);
    assert_eq!(st.client.attestor(), new_attestor);

    // the old attestor can no longer stamp
    env.set_auths(&[]);
    let place = s(env, "wat-chalong");
    let res = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.attestor,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "stamp",
                args: (st.traveller.clone(), place.clone(), hash(env, 9), NOW).into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_stamp(&st.traveller, &place, &hash(env, 9), &NOW);
    assert_auth_err(res);
}

#[test]
fn two_step_admin_handover() {
    let st = setup();
    let env = &st.env;
    assert_contract_err(st.client.try_accept_admin(), Error::NoPendingAdmin);

    let new_admin = Address::generate(env);
    st.client.propose_admin(&new_admin);
    assert_eq!(st.client.admin(), st.admin); // not yet

    st.client.accept_admin();
    assert_eq!(
        env.auths()[0].0,
        new_admin,
        "accept_admin must be signed by the proposed admin"
    );
    assert_eq!(st.client.admin(), new_admin);
    assert_contract_err(st.client.try_accept_admin(), Error::NoPendingAdmin);
}

#[test]
fn accept_admin_requires_pending_admin_signature() {
    let st = setup();
    let env = &st.env;
    let new_admin = Address::generate(env);
    st.client.propose_admin(&new_admin);
    env.set_auths(&[]);
    // old admin signs accept_admin: rejected
    let res = st
        .client
        .mock_auths(&[MockAuth {
            address: &st.admin,
            invoke: &MockAuthInvoke {
                contract: &st.client.address,
                fn_name: "accept_admin",
                args: ().into_val(env),
                sub_invokes: &[],
            },
        }])
        .try_accept_admin();
    assert_auth_err(res);
    assert_eq!(st.client.admin(), st.admin);
}

#[test]
fn upgrade_with_unknown_wasm_fails_even_for_admin() {
    let st = setup();
    // mock_all_auths is on, so this fails only because the wasm is not uploaded
    assert!(st.client.try_upgrade(&hash(&st.env, 0)).is_err());
    assert_eq!(st.client.version(), VERSION);
}
