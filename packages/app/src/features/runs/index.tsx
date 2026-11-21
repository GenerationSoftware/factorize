import { Page } from "../../shared/ui";
import { RunList } from "./list";
export function RunsIndex() { return <Page><RunList limit={20} /></Page>; }
