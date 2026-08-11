// 文件说明：定义对账资料的上传格式、大小限制和文件类型展示规则。
export const reconciliationAcceptedExtensions = [
  ".xlsx",
  ".xls",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

export const reconciliationAcceptedMimeTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export const reconciliationFileAccept = [
  ...reconciliationAcceptedExtensions,
  ...reconciliationAcceptedMimeTypes,
].join(",");

export const reconciliationMaxFileSizeMb = 20;
export const reconciliationMaxFileSizeBytes = reconciliationMaxFileSizeMb * 1024 * 1024;
export const reconciliationFileHint = "支持 Excel、PDF、PNG/JPG，单个文件不超过 20 MB";
export const reconciliationReadableFileTypes = ".xlsx / .xls / .pdf / .png / .jpg / .jpeg";

type UploadFileLike = Pick<File, "name" | "size" | "type">;

const acceptedExtensionSet = new Set<string>(reconciliationAcceptedExtensions);
const acceptedMimeTypeSet = new Set<string>(reconciliationAcceptedMimeTypes);
const extensionLabels: Record<string, string> = {
  ".xlsx": "Excel 工作簿",
  ".xls": "Excel 工作簿",
  ".pdf": "PDF 文档",
  ".png": "PNG 图片",
  ".jpg": "JPEG 图片",
  ".jpeg": "JPEG 图片",
};
const mimeTypeLabels: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel 工作簿",
  "application/vnd.ms-excel": "Excel 工作簿",
  "application/pdf": "PDF 文档",
  "image/png": "PNG 图片",
  "image/jpeg": "JPEG 图片",
};
const fileBadges: Record<string, string> = {
  ".xlsx": "XLS",
  ".xls": "XLS",
  ".pdf": "PDF",
  ".png": "IMG",
  ".jpg": "IMG",
  ".jpeg": "IMG",
};

export function getReconciliationFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return null;
  return fileName.slice(dotIndex).toLowerCase();
}

export function getReconciliationFileTypeLabel(file: Pick<UploadFileLike, "name" | "type">) {
  const extension = getReconciliationFileExtension(file.name);
  if (extension && extensionLabels[extension]) return extensionLabels[extension];
  if (file.type && mimeTypeLabels[file.type]) return mimeTypeLabels[file.type];
  return "对账资料";
}

export function getReconciliationFileBadge(file: Pick<UploadFileLike, "name" | "type">) {
  const extension = getReconciliationFileExtension(file.name);
  if (extension && fileBadges[extension]) return fileBadges[extension];
  if (file.type.startsWith("image/")) return "IMG";
  if (file.type === "application/pdf") return "PDF";
  return "FILE";
}

export function formatFileSize(fileSize: number) {
  return `${(fileSize / 1024 / 1024).toFixed(2)} MB`;
}

export function validateReconciliationFile(file: UploadFileLike) {
  const extension = getReconciliationFileExtension(file.name);
  const hasAcceptedExtension = extension ? acceptedExtensionSet.has(extension) : false;
  const hasAcceptedMimeType = file.type ? acceptedMimeTypeSet.has(file.type) : false;

  if (!hasAcceptedExtension && !hasAcceptedMimeType) {
    return `仅支持 ${reconciliationReadableFileTypes} 文件`;
  }

  if (file.size > reconciliationMaxFileSizeBytes) {
    return `单个文件不能超过 ${reconciliationMaxFileSizeMb} MB`;
  }

  return null;
}

export function getReconciliationFileMetadata(file: UploadFileLike) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    extension: getReconciliationFileExtension(file.name),
  };
}
