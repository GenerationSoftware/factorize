import Markdown from "react-markdown";
import { SkillDirectory } from "./directory";
import { SkillEditor, type Definition } from "./editor";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Page, PageHeader } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { skillQuery } from "./queries";
export function SkillDetail() {
  const { skillId } = useParams({ strict: false });
  const cache = useQueryClient(), skill = useQuery(skillQuery(skillId!));
  const [editing, setEditing] = useState<{ definition: Definition; revision: number }>();
  const edit = useMutation({ mutationFn: async ({ definition, revision }: { definition: Definition; revision: number }) => {
    const result = await api.PUT("/api/v1/skills/{skillId}", { params: { path: { skillId: skillId! } }, body: { key: definition.name, definition, expectedRevision: revision } });
    if (!result.data || result.error) throw new Error(messageOf(result.error)); return result.data;
  }, onSuccess: async updated => { cache.setQueryData(skillQuery(skillId!).queryKey, updated); setEditing(undefined); await cache.invalidateQueries({ queryKey: ["skills", "list"] }); } });
  const definition = skill.data?.definition ?? (skill.data ? { name: skill.data.key, description: "", markdown: skill.data.body } : undefined);
  return <Page>{skill.isPending && <p role="status">Loading skill…</p>}{skill.error && <p role="alert">{skill.error.message}</p>}{skill.data && definition && <><PageHeader title={skill.data.key} description={`Revision ${skill.data.revision}`}><Button onClick={() => setEditing({ definition, revision: skill.data!.revision })}>Edit</Button></PageHeader>{editing ? <SkillEditor initial={editing.definition} pending={edit.isPending} error={edit.error} save={value => edit.mutate({ definition: value, revision: editing.revision })} cancel={() => setEditing(undefined)} /> : <Card><div className="skill-markdown space-y-4 break-words [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-stone-100 [&_pre]:p-4 dark:[&_pre]:bg-slate-950"><Markdown skipHtml>{definition.markdown}</Markdown></div></Card>}<SkillDirectory skillId={skillId!} revision={skill.data.revision}/>{edit.error && <p role="alert">{edit.error.message}</p>}</>}</Page>;
}
