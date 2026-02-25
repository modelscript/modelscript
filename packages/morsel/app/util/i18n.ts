// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Translations {
  // Dock tooltips
  toggleTree: string;
  newModel: string;
  openModel: string;
  saveModel: string;
  autoLayout: string;
  flattenModel: string;
  shareModel: string;
  sponsorMe: string;
  language: string;
  diagramView: string;
  splitViewColumns: string;
  splitViewRows: string;
  codeView: string;
  switchToDark: string;
  switchToLight: string;

  // Search
  filterClasses: string;

  // Splash
  newModelTitle: string;
  recentModels: string;
  exampleModels: string;
  createNew: string;
  clearRecent: string;
  close: string;

  // Properties
  noComponentSelected: string;
  information: string;
  type: string;
  name: string;
  description: string;
  addDescription: string;
  parameters: string;
  documentation: string;
  revisions: string;

  // Component list
  noClassSelected: string;
  noComponents: string;

  // Share dialog
  shareModelTitle: string;
  copyToClipboard: string;
  copiedToClipboard: string;

  // Unsaved changes dialog
  unsavedChanges: string;
  unsavedChangesMessage: string;
  cancel: string;
  discardChanges: string;

  // Open file dialog
  openFile: string;
  dropFileHere: string;
  dragDropModelica: string;
  orClickToSelect: string;

  // Add library modal
  addLibrary: string;
  addLibraryMethods: string;
  upload: string;
  url: string;
  dropZipHere: string;
  dragDropZip: string;
  clickToSelectFile: string;
  processingLibrary: string;
  libraryUrl: string;
  downloadAndAdd: string;
  downloading: string;

  // Auto layout
  autoLayoutConfirm: string;

  // Language
  default: string;
  languageLabel: string;

  // Components
  components: string;
  libraries: string;
}

const en: Translations = {
  // Dock tooltips
  toggleTree: "Toggle Tree",
  newModel: "New Model",
  openModel: "Open Model",
  saveModel: "Save Model",
  autoLayout: "Auto Layout",
  flattenModel: "Flatten Model",
  shareModel: "Share Model",
  sponsorMe: "Sponsor Me",
  language: "Language",
  diagramView: "Diagram View",
  splitViewColumns: "Split View (Columns)",
  splitViewRows: "Split View (Rows)",
  codeView: "Code View",
  switchToDark: "Switch to dark mode",
  switchToLight: "Switch to light mode",

  // Search
  filterClasses: "Filter classes...",

  // Splash
  newModelTitle: "New Model",
  recentModels: "Recent Models",
  exampleModels: "Example Models",
  createNew: "Create New",
  clearRecent: "Clear Recent Models",
  close: "Close",

  // Properties
  noComponentSelected: "No component selected",
  information: "INFORMATION",
  type: "Type",
  name: "Name",
  description: "Description",
  addDescription: "Add Description",
  parameters: "PARAMETERS",
  documentation: "DOCUMENTATION",
  revisions: "REVISIONS",

  // Component list
  noClassSelected: "No class selected",
  noComponents: "No components",

  // Share dialog
  shareModelTitle: "Share Model",
  copyToClipboard: "Copy to clipboard",
  copiedToClipboard: "Copied to clipboard.",

  // Unsaved changes dialog
  unsavedChanges: "Unsaved Changes",
  unsavedChangesMessage:
    "You have unsaved changes. Any unsaved changes will be lost if you switch without saving. Are you sure you want to discard your changes?",
  cancel: "Cancel",
  discardChanges: "Discard Changes",

  // Open file dialog
  openFile: "Open File",
  dropFileHere: "Drop the file here",
  dragDropModelica: "Drag & drop a Modelica file here",
  orClickToSelect: "or click to select a file",

  // Add library modal
  addLibrary: "Add Library",
  addLibraryMethods: "Add Library Methods",
  upload: "Upload",
  url: "URL",
  dropZipHere: "Drop the ZIP file here",
  dragDropZip: "Drag & drop a ZIP file here",
  clickToSelectFile: "or click to select a file",
  processingLibrary: "Processing library...",
  libraryUrl: "Library URL (ZIP)",
  downloadAndAdd: "Download & Add",
  downloading: "Downloading...",

  // Auto layout
  autoLayoutConfirm:
    "Running auto layout will overwrite existing placement annotations. Are you sure you want to auto layout the diagram?",

  // Language
  default: "Default",
  languageLabel: "Language",

  // Components
  components: "Components",
  libraries: "Libraries",
};

const ar: Translations = {
  // Dock tooltips
  toggleTree: "إظهار/إخفاء الشجرة",
  newModel: "نموذج جديد",
  openModel: "فتح نموذج",
  saveModel: "حفظ النموذج",
  autoLayout: "تخطيط تلقائي",
  flattenModel: "تسطيح النموذج",
  shareModel: "مشاركة النموذج",
  sponsorMe: "ادعمني",
  language: "اللغة",
  diagramView: "عرض المخطط",
  splitViewColumns: "عرض مقسم (أعمدة)",
  splitViewRows: "عرض مقسم (صفوف)",
  codeView: "عرض الكود",
  switchToDark: "التبديل إلى الوضع الداكن",
  switchToLight: "التبديل إلى الوضع الفاتح",

  // Search
  filterClasses: "تصفية الفئات...",

  // Splash
  newModelTitle: "نموذج جديد",
  recentModels: "النماذج الأخيرة",
  exampleModels: "نماذج توضيحية",
  createNew: "إنشاء جديد",
  clearRecent: "مسح النماذج الأخيرة",
  close: "إغلاق",

  // Properties
  noComponentSelected: "لم يتم تحديد أي مكوّن",
  information: "المعلومات",
  type: "النوع",
  name: "الاسم",
  description: "الوصف",
  addDescription: "إضافة وصف",
  parameters: "المعاملات",
  documentation: "التوثيق",
  revisions: "المراجعات",

  // Component list
  noClassSelected: "لم يتم تحديد أي فئة",
  noComponents: "لا توجد مكوّنات",

  // Share dialog
  shareModelTitle: "مشاركة النموذج",
  copyToClipboard: "نسخ إلى الحافظة",
  copiedToClipboard: "تم النسخ إلى الحافظة.",

  // Unsaved changes dialog
  unsavedChanges: "تغييرات غير محفوظة",
  unsavedChangesMessage:
    "لديك تغييرات غير محفوظة. ستفقد أي تغييرات غير محفوظة إذا انتقلت دون حفظ. هل أنت متأكد أنك تريد تجاهل التغييرات؟",
  cancel: "إلغاء",
  discardChanges: "تجاهل التغييرات",

  // Open file dialog
  openFile: "فتح ملف",
  dropFileHere: "أسقط الملف هنا",
  dragDropModelica: "اسحب وأسقط ملف Modelica هنا",
  orClickToSelect: "أو انقر لاختيار ملف",

  // Add library modal
  addLibrary: "إضافة مكتبة",
  addLibraryMethods: "طرق إضافة المكتبة",
  upload: "رفع",
  url: "رابط",
  dropZipHere: "أسقط ملف ZIP هنا",
  dragDropZip: "اسحب وأسقط ملف ZIP هنا",
  clickToSelectFile: "أو انقر لاختيار ملف",
  processingLibrary: "جارٍ معالجة المكتبة...",
  libraryUrl: "رابط المكتبة (ZIP)",
  downloadAndAdd: "تنزيل وإضافة",
  downloading: "جارٍ التنزيل...",

  // Auto layout
  autoLayoutConfirm:
    "سيؤدي التخطيط التلقائي إلى الكتابة فوق التعليقات التوضيحية الحالية. هل أنت متأكد أنك تريد تخطيط المخطط تلقائيًا؟",

  // Language
  default: "افتراضي",
  languageLabel: "اللغة",

  // Components
  components: "المكوّنات",
  libraries: "المكتبات",
};

const tr: Translations = {
  // Dock tooltips
  toggleTree: "Ağacı Aç/Kapat",
  newModel: "Yeni Model",
  openModel: "Model Aç",
  saveModel: "Modeli Kaydet",
  autoLayout: "Otomatik Düzen",
  flattenModel: "Modeli Düzleştir",
  shareModel: "Modeli Paylaş",
  sponsorMe: "Bana Destek Ol",
  language: "Dil",
  diagramView: "Diyagram Görünümü",
  splitViewColumns: "Bölünmüş Görünüm (Sütunlar)",
  splitViewRows: "Bölünmüş Görünüm (Satırlar)",
  codeView: "Kod Görünümü",
  switchToDark: "Karanlık moda geç",
  switchToLight: "Aydınlık moda geç",

  // Search
  filterClasses: "Sınıfları filtrele...",

  // Splash
  newModelTitle: "Yeni Model",
  recentModels: "Son Modeller",
  exampleModels: "Örnek Modeller",
  createNew: "Yeni Oluştur",
  clearRecent: "Son Modelleri Temizle",
  close: "Kapat",

  // Properties
  noComponentSelected: "Bileşen seçilmedi",
  information: "BİLGİ",
  type: "Tür",
  name: "Ad",
  description: "Açıklama",
  addDescription: "Açıklama Ekle",
  parameters: "PARAMETRELER",
  documentation: "DOKÜMANTASYON",
  revisions: "REVİZYONLAR",

  // Component list
  noClassSelected: "Sınıf seçilmedi",
  noComponents: "Bileşen yok",

  // Share dialog
  shareModelTitle: "Modeli Paylaş",
  copyToClipboard: "Panoya kopyala",
  copiedToClipboard: "Panoya kopyalandı.",

  // Unsaved changes dialog
  unsavedChanges: "Kaydedilmemiş Değişiklikler",
  unsavedChangesMessage:
    "Kaydedilmemiş değişiklikleriniz var. Kaydetmeden geçiş yaparsanız kaydedilmemiş değişiklikler kaybolacaktır. Değişiklikleri silmek istediğinizden emin misiniz?",
  cancel: "İptal",
  discardChanges: "Değişiklikleri Sil",

  // Open file dialog
  openFile: "Dosya Aç",
  dropFileHere: "Dosyayı buraya bırakın",
  dragDropModelica: "Modelica dosyasını sürükleyip bırakın",
  orClickToSelect: "veya dosya seçmek için tıklayın",

  // Add library modal
  addLibrary: "Kütüphane Ekle",
  addLibraryMethods: "Kütüphane Ekleme Yöntemleri",
  upload: "Yükle",
  url: "URL",
  dropZipHere: "ZIP dosyasını buraya bırakın",
  dragDropZip: "ZIP dosyasını sürükleyip bırakın",
  clickToSelectFile: "veya dosya seçmek için tıklayın",
  processingLibrary: "Kütüphane işleniyor...",
  libraryUrl: "Kütüphane URL'si (ZIP)",
  downloadAndAdd: "İndir ve Ekle",
  downloading: "İndiriliyor...",

  // Auto layout
  autoLayoutConfirm:
    "Otomatik düzen mevcut yerleşim açıklamalarının üzerine yazacaktır. Diyagramı otomatik düzenlemek istediğinizden emin misiniz?",

  // Language
  default: "Varsayılan",
  languageLabel: "Dil",

  // Components
  components: "Bileşenler",
  libraries: "Kütüphaneler",
};

const translations: Record<string, Translations> = { en, ar, tr };

export function getTranslations(language: string | null): Translations {
  if (language && translations[language]) {
    return translations[language];
  }
  return en;
}
