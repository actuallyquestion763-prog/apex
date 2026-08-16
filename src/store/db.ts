import type { Notification } from '../types'

// This module ONLY handles local, non-financial, non-security UI state
// (notifications — the backend has no notification model yet). It must
// never again hold session/user/balance/position/transaction/KYC data —
// those are authoritative on the backend only. See src/store/auth.tsx and
// src/store/useStore.ts.
const PREFIX = 'trust::'

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch { return fallback }
}

function write<T>(key: string, value: T): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch { /* ignore */ }
}

export function loadNotifications(): Notification[] {
  return read<Notification[]>('notifications', [])
}

export function saveNotifications(notifications: Notification[]): void {
  write('notifications', notifications)
}

export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
