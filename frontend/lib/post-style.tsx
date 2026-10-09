"use client";

import { createContext, useContext } from "react";

/** How posts are drawn for the open business: the copyright watermark is on unless the owner turned it off. */
export const PostStyle = createContext<{ watermark: boolean }>({ watermark: true });
export const usePostStyle = () => useContext(PostStyle);
