import { Page, PageHeader } from "../../shared/ui";
import { RunList } from "./list";
export function RunsIndex() { return <Page><PageHeader title="Runs" /><RunList limit={20} /></Page>; }
