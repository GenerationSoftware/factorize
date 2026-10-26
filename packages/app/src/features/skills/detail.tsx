import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Breadcrumb, Button, Card, Input, Label, Page, PageHeader, Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { skillQuery, skillsQuery } from "./queries";

export function SkillDetail() {
  const { skillId } = useParams({ from: "/skills/$skillId" });
  const skill = useQuery(skillQuery(skillId));
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false), [key, setKey] = useState(""), [body, setBody] = useState("");
  const edit = useMutation({ mutationFn: async () => { const result = await api.PUT("/api/v1/skills/{skillId}", { params: { path: { skillId } }, body: { key, body, expectedRevision: skill.data!.revision } }); if (!result.data || result.error) throw new Error(messageOf(result.error)); return result.data; }, onSuccess: async updated => { cache.setQueryData(skillQuery(skillId).queryKey, updated); await cache.invalidateQueries({ queryKey: skillsQuery().queryKey }); setEditing(false); } });
  const startEditing = () => { if (!skill.data) return; setKey(skill.data.key); setBody(skill.data.body); setEditing(true); };
  return <Page className="max-w-5xl"><Breadcrumb><Link to="/skills" className="font-semibold">Skills</Link><span aria-hidden="true">/</span><span>{skill.data?.key ?? "Skill"}</span></Breadcrumb>{skill.isPending && <p role="status">Loading skill…</p>}{skill.error && <p role="alert">{skill.error.message}</p>}{skill.data && <><PageHeader title={skill.data.key} description={`${skill.data.usageCount} job uses · revision ${skill.data.revision}`}><Button onClick={startEditing}>Edit</Button></PageHeader>{editing ? <Card><form className="grid gap-4" onSubmit={event => { event.preventDefault(); edit.mutate(); }}><Label>Key<Input required pattern="[a-z][a-z0-9_-]{0,63}" value={key} onChange={event => setKey(event.target.value)} /></Label><Label>Literal body<Textarea required className="min-h-56" value={body} onChange={event => setBody(event.target.value)} /></Label><p className="text-sm text-slate-600 dark:text-slate-400">Shared edits affect every job that uses this skill and only future runs.</p>{edit.error && <p role="alert">{edit.error.message}</p>}<div className="flex gap-2"><Button type="button" onClick={() => setEditing(false)} disabled={edit.isPending}>Cancel</Button><Button type="submit" variant="primary" disabled={edit.isPending}>{edit.isPending ? "Saving…" : "Save skill"}</Button></div></form></Card> : <Card><h2 className="mb-3">Instructions</h2><pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6">{skill.data.body}</pre></Card>}</>}</Page>;
}
