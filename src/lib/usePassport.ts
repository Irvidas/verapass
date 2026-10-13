import { useSyncExternalStore } from 'react'
import { createPassportStore, type PassportState } from './passport'
import { browserStorage } from './storage'
import { createTravellerSession } from './traveller'

export const passportStore = createPassportStore(typeof window === 'undefined' ? null : browserStorage())
export const travellerSession = createTravellerSession(passportStore)

export function usePassport(): PassportState {
  return useSyncExternalStore(passportStore.subscribe, passportStore.getState, passportStore.getState)
}
