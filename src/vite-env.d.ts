/// <reference types="vite/client" />
// 文件说明：引入 Vite 提供的前端环境变量和资源类型声明。

interface ImportMetaEnv {
  readonly VITE_RECONCILIATION_UPLOAD_URL?: string;
  readonly VITE_CHERRYSTUDIO_BASE_URL?: string;
  readonly VITE_CHERRYSTUDIO_API_KEY?: string;
  readonly VITE_CHERRYSTUDIO_DEFAULT_AGENT_NAME?: string;
  readonly VITE_CHERRYSTUDIO_DEFAULT_AGENT_WORKSPACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
