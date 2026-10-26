// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export const createBot = async (payload: {
  username: string;
  display_name: string;
  bio?: string | undefined;
  avatar_url?: string | undefined;
  scopes?: string | undefined;
  system_prompt?: string | undefined;
  model?: string | undefined;
  api_key?: string | undefined;
  endpoint_url?: string | undefined;
}) => {
  const { data } = await api.post("/users/me/bots", payload);
  return data;
};

export const updateBot = async (
  botId: number,
  payload: {
    display_name?: string | undefined;
    bio?: string | undefined;
    avatar_url?: string | undefined;
    scopes?: string | undefined;
    system_prompt?: string | undefined;
    model?: string | undefined;
    api_key?: string | undefined;
    endpoint_url?: string | undefined;
  },
) => {
  const { data } = await api.patch(`/users/me/bots/${botId}`, payload);
  return data;
};

export const getBots = async () => {
  const { data } = await api.get("/users/me/bots");
  return data.bots;
};

export const deleteBot = async (botId: number) => {
  const { data } = await api.delete(`/users/me/bots/${botId}`);
  return data;
};
