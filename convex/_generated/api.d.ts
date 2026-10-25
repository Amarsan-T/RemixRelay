/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assistantPrompt from "../assistantPrompt.js";
import type * as chat from "../chat.js";
import type * as chatAgent from "../chatAgent.js";
import type * as chatLimits from "../chatLimits.js";
import type * as musicContext from "../musicContext.js";
import type * as projectChanges from "../projectChanges.js";
import type * as projects from "../projects.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assistantPrompt: typeof assistantPrompt;
  chat: typeof chat;
  chatAgent: typeof chatAgent;
  chatLimits: typeof chatLimits;
  musicContext: typeof musicContext;
  projectChanges: typeof projectChanges;
  projects: typeof projects;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
