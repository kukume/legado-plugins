/** 书架中的书（阅读 Web 开放接口 GET /openapi/v1/shelf） */
export interface Book {
  /** 书本 id，开放接口中用来获取目录、正文和保存进度 */
  id: number;
  name: string;
  author: string;
  /** 书源名称 */
  originName: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  latestChapterTitle?: string;
  totalChapterNum?: number;
  /** 当前阅读章节序号（服务器目录中的序号，含卷名） */
  durChapterIndex: number;
  /** 章节内阅读位置（本地使用） */
  durChapterPos: number;
  durChapterTitle?: string;
}

/** 章节（卷名已过滤） */
export interface BookChapter {
  /** 服务器目录中的章节序号（获取正文、保存进度时使用；与列表下标不一定相同） */
  index: number;
  title: string;
}

export interface ApiConfig {
  /** 阅读 Web 服务器地址 */
  address: string;
  /** 开放接口的 API Key */
  apiKey: string;
  enableErrorLog: boolean;
}

export type ChapterOption =
  | { type: "chapter"; index: number; title: string }
  | { type: "morePrev"; remaining: number }
  | { type: "moreNext"; remaining: number };
