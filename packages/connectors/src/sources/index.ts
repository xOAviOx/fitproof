import type { AtsType } from "@repo/core";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { BoardConnector } from "./types";
import { workable } from "./workable";

export const BOARD_CONNECTORS: Partial<Record<AtsType, BoardConnector>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
};

export { ADZUNA_HOST, type AdzunaKeys, type AdzunaQuery, searchAdzuna } from "./adzuna";
export {
  createSourceClient,
  type SourceClient,
  type SourceClientOptions,
  SourceError,
  type SourceErrorCode,
} from "./client";
export type { BoardConnector, BoardRef, ListedPosting, PostingDetail } from "./types";
