import { fetchWithoutRedirects } from "../../../transport/http/fetch-without-redirects";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { awsMcpSessionPolicy, type AwsRegion } from "./policy";
import { awsResponseText, AwsUpstreamError } from "./wire";

const credentialsSchema = z.object({
  AccessKeyId: z.string().regex(/^ASIA[A-Z0-9]{16}$/),
  SecretAccessKey: z.string().regex(/^[A-Za-z0-9/+=]{40}$/),
  SessionToken: z.string().regex(/^[A-Za-z0-9/+=]{16,8192}$/),
  Expiration: z.iso.datetime({ offset: true }),
});
export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };

export async function exchangeAwsWorkload(region: AwsRegion, roleArn: string, jwt: string, connectionId: string, signal?: AbortSignal): Promise<AwsCredentials> {
  const response = await fetchWithoutRedirects(`https://sts.${region}.amazonaws.com/`, {
    method: "POST", signal: awsDeadline(8_000, signal),
    body: new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn,
      RoleSessionName: "factorize-" + connectionId, WebIdentityToken: jwt, DurationSeconds: "900",
      Policy: JSON.stringify(awsMcpSessionPolicy),
    }),
  });
  const xml = await awsResponseText(response, 32_768);
  if (!response.ok) throw new AwsUpstreamError(
    [400, 401, 403].includes(response.status) ? "trust" : "upstream",
  );
  // AWS returns the documented Query XML envelope. Don't accept DTDs or entities.
  if (/<!/i.test(xml)) throw new AwsUpstreamError("upstream");
  const value = new XMLParser({ processEntities: false, parseTagValue: false }).parse(xml);
  const result = credentialsSchema.safeParse(value?.AssumeRoleWithWebIdentityResponse?.AssumeRoleWithWebIdentityResult?.Credentials);
  if (!result.success || Date.parse(result.data.Expiration) < Date.now() + 60_000) throw new AwsUpstreamError("upstream");
  const c = result.data;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

export function awsDeadline(ms: number, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([deadline, signal]) : deadline;
}
