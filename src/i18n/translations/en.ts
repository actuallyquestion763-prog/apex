// Canonical English source of truth — every other language file is a
// same-shaped Partial<typeof en>, and any key it's missing simply falls
// back to this English text (see i18n/index.ts's t()) rather than showing
// a blank string or a raw key. This dictionary intentionally covers only
// the navigation + Mine (profile/security/languages) surface for now —
// every other page's text is still literal English JSX, not silently
// mistranslated or blanked, just not yet wired into i18n.
const en = {
  'nav.home': 'Home',
  'nav.markets': 'Markets',
  'nav.trade': 'Trade',
  'nav.assets': 'Assets',
  'nav.mine': 'Mine',
  'nav.admin': 'Admin',

  'profile.uid': 'UID',
  'profile.invitationCode': 'Invitation code',
  'profile.copy': 'Copy',
  'profile.copied': 'Copied!',
  'profile.kyc.verified': 'Verified',
  'profile.kyc.pending': 'Verification pending',
  'profile.kyc.rejected': 'Rejected — review required',
  'profile.kyc.expired': 'Verification expired',
  'profile.kyc.notStarted': 'Verification required',
  'profile.action.deposit': 'Deposit',
  'profile.action.withdraw': 'Withdraw',
  'profile.action.convert': 'Convert',
  'profile.menu.transactionRecords': 'Transaction Records',
  'profile.menu.kyc': 'KYC',
  'profile.menu.security': 'Security',
  'profile.menu.languages': 'Languages',
  'profile.menu.about': 'About',
  'profile.menu.admin': 'Admin panel',
  'profile.logout': 'Log out',

  'security.setNewPassword.title': 'Set new password',
  'security.setNewPassword.subtitle': 'Change your account password',
  'security.twoFactor.title': 'Two-factor authentication',
  'security.twoFactor.enabled': 'Enabled',
  'security.twoFactor.notEnabled': 'Not enabled',
  'security.twoFactor.on': 'On',
  'security.twoFactor.off': 'Off',
  'security.disclosure': "Face ID / biometric sign-in and session-device management aren't available yet on this platform. Password change, two-factor authentication, and logout are fully functional.",

  'setNewPassword.title': 'Set new password',
  'setNewPassword.subtitle': 'Changing your password signs you out of every other device.',
  'setNewPassword.currentPassword': 'Current password',
  'setNewPassword.newPassword': 'New password',
  'setNewPassword.confirmNewPassword': 'Confirm new password',
  'setNewPassword.minChars': 'At least 8 characters.',
  'setNewPassword.submit': 'Change password',
  'setNewPassword.submitting': 'Changing password…',
  'setNewPassword.error.currentRequired': 'Enter your current password.',
  'setNewPassword.error.tooShort': 'New password must be at least 8 characters.',
  'setNewPassword.error.mismatch': 'New passwords do not match.',
  'setNewPassword.success': 'Password changed. Other signed-in devices have been logged out.',
  'setNewPassword.error.generic': 'Could not change password.',

  'languages.title': 'Language',
  'languages.subtitle': 'Choose the language TRUST is displayed in.',
  'languages.footnote': "Selected language applies to navigation and account pages now; full app-wide translation is rolling out to more pages over time. Anything not yet translated shows in English.",
} as const

export default en
export type TranslationKey = keyof typeof en
