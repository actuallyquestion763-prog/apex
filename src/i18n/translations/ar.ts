import type { TranslationKey } from './en'

// Arabic is right-to-left — see i18n/index.ts, which sets document
// direction based on LANGUAGES[].rtl when this language is active.
const ar: Partial<Record<TranslationKey, string>> = {
  'nav.home': 'الرئيسية',
  'nav.markets': 'الأسواق',
  'nav.trade': 'تداول',
  'nav.assets': 'الأصول',
  'nav.mine': 'حسابي',
  'nav.admin': 'الإدارة',

  'profile.uid': 'المعرف',
  'profile.invitationCode': 'رمز الدعوة',
  'profile.copy': 'نسخ',
  'profile.copied': 'تم النسخ!',
  'profile.kyc.verified': 'تم التحقق',
  'profile.kyc.pending': 'التحقق قيد المراجعة',
  'profile.kyc.rejected': 'مرفوض — يتطلب المراجعة',
  'profile.kyc.expired': 'انتهت صلاحية التحقق',
  'profile.kyc.notStarted': 'التحقق مطلوب',
  'profile.action.deposit': 'إيداع',
  'profile.action.withdraw': 'سحب',
  'profile.action.convert': 'تحويل',
  'profile.menu.transactionRecords': 'سجل المعاملات',
  'profile.menu.kyc': 'التحقق من الهوية',
  'profile.menu.security': 'الأمان',
  'profile.menu.languages': 'اللغات',
  'profile.menu.about': 'حول',
  'profile.menu.admin': 'لوحة الإدارة',
  'profile.logout': 'تسجيل الخروج',

  'security.setNewPassword.title': 'تعيين كلمة مرور جديدة',
  'security.setNewPassword.subtitle': 'تغيير كلمة مرور حسابك',
  'security.twoFactor.title': 'المصادقة الثنائية',
  'security.twoFactor.enabled': 'مفعّلة',
  'security.twoFactor.notEnabled': 'غير مفعّلة',
  'security.twoFactor.on': 'تشغيل',
  'security.twoFactor.off': 'إيقاف',
  'security.disclosure': 'تسجيل الدخول البيومتري / Face ID وإدارة الجلسات والأجهزة غير متاحة بعد على هذه المنصة. تغيير كلمة المرور والمصادقة الثنائية وتسجيل الخروج تعمل بشكل كامل.',

  'setNewPassword.title': 'تعيين كلمة مرور جديدة',
  'setNewPassword.subtitle': 'سيؤدي تغيير كلمة المرور إلى تسجيل خروجك من جميع الأجهزة الأخرى.',
  'setNewPassword.currentPassword': 'كلمة المرور الحالية',
  'setNewPassword.newPassword': 'كلمة المرور الجديدة',
  'setNewPassword.confirmNewPassword': 'تأكيد كلمة المرور الجديدة',
  'setNewPassword.minChars': '8 أحرف على الأقل.',
  'setNewPassword.submit': 'تغيير كلمة المرور',
  'setNewPassword.submitting': 'جارٍ تغيير كلمة المرور…',
  'setNewPassword.error.currentRequired': 'أدخل كلمة المرور الحالية.',
  'setNewPassword.error.tooShort': 'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.',
  'setNewPassword.error.mismatch': 'كلمتا المرور الجديدتان غير متطابقتين.',
  'setNewPassword.success': 'تم تغيير كلمة المرور. تم تسجيل خروج الأجهزة الأخرى المتصلة.',
  'setNewPassword.error.generic': 'تعذر تغيير كلمة المرور.',

  'languages.title': 'اللغة',
  'languages.subtitle': 'اختر اللغة التي تُعرض بها TRUST.',
  'languages.footnote': 'تُطبَّق اللغة المختارة الآن على التنقل وصفحات الحساب؛ ويجري تدريجيًا طرح الترجمة الكاملة للتطبيق على المزيد من الصفحات. ما لم تتم ترجمته بعد يظهر بالإنجليزية.',
}

export default ar
