import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { AccountSettingsLayout } from "./navigation";
import { Button, Card, Input, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";
export function Profile() {
  const cache = useQueryClient();
  const [username, setUsername] = useState<string>();
  const profile = useQuery({ queryKey: ["profile"], queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/profile");
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }});
  const save = useMutation({ mutationFn: async () => {
    const { data, error } = await api.PUT("/api/v1/profile", { body: { username: username ?? profile.data!.username } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }, onSuccess: async data => { cache.setQueryData(["profile"], data); await Promise.all([cache.invalidateQueries({queryKey:["session"]}), cache.invalidateQueries({queryKey:["team"]})]); }});
  return <AccountSettingsLayout title="Profile">{profile.error && <p role="alert">{profile.error.message}</p>}{profile.isPending && <p role="status">Loading profile…</p>}{profile.data && <Card><form className="grid max-w-lg gap-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}><Label>Username<Input required minLength={3} maxLength={39} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="username" value={username ?? profile.data.username} onChange={event => setUsername(event.target.value.toLowerCase())} /></Label><p className="text-sm">3–39 lowercase letters or numbers, with single hyphens between segments. Your personal team uses this name.</p><p>{profile.data.email}</p>{save.error && <p role="alert">{save.error.message}</p>}{save.isSuccess && <p role="status">Profile saved.</p>}<Button disabled={save.isPending}>Save profile</Button></form></Card>}</AccountSettingsLayout>;
}
