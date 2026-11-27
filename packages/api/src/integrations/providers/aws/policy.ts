export const awsIssuerPath = "/oauth/aws";
export const awsAudience = "sts.amazonaws.com";
const awsMcpPrincipal = "aws-mcp.amazonaws.com";

export const awsRegions = ["us-east-1", "us-west-2", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "eu-central-1", "eu-west-1", "eu-west-2"] as const;
export type AwsRegion = typeof awsRegions[number];

export const awsSubject = (id: string) => "factorize-aws:" + id;
const calledViaMcp = { StringEquals: { "aws:CalledViaAWSMCP": awsMcpPrincipal } };
const starterPolicy = {
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow", Action: ["lambda:ListFunctions", "ec2:DescribeInstances", "cloudfront:ListDistributions"],
    Resource: "*", Condition: calledViaMcp,
  }],
};

// STS intersects these permissions with the role set by the AWS account owner.
// Do not hard-code a product catalog of actions; keep direct credential use,
// IAM changes, credential chaining and interactive host access out of Code Mode.
export const awsMcpSessionPolicy = {
  Version: "2012-10-17",
  Statement: [
    { Effect: "Allow", Action: "*", Resource: "*", Condition: calledViaMcp },
    { Effect: "Deny", Action: [
      "iam:*", "organizations:*", "sts:Assume*", "sts:Get*Token", "sts:GetFederationToken",
      "ssm:SendCommand", "ssm:StartSession", "ssm:ResumeSession", "ec2-instance-connect:*", "ecs:ExecuteCommand",
    ], Resource: "*" },
  ],
};
export const awsVerificationMarker = "factorize-aws-connection-verified";
export const awsVerificationScript = JSON.stringify(awsVerificationMarker);

export function awsRoleTemplate(issuer: string, connectionId: string) {
  const issuerKey = new URL(issuer).host + awsIssuerPath;
  const provider = { "Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/" + issuerKey };
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Trust one Factorize connection for AWS MCP Code Mode. The initial role policy grants three read-only inventory operations.",
    Parameters: {
      CreateProvider: { Type: "String", Default: "true", AllowedValues: ["true", "false"], Description: "Choose false if this AWS account already trusts this Factorize OIDC issuer." },
    },
    Conditions: { ProvisionProvider: { "Fn::Equals": [{ Ref: "CreateProvider" }, "true"] } },
    Resources: {
      FactorizeProvider: {
        Type: "AWS::IAM::OIDCProvider", Condition: "ProvisionProvider", DeletionPolicy: "Retain",
        Properties: { Url: issuer, ClientIdList: [awsAudience] },
      },
      FactorizeRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17", Statement: [{
              Effect: "Allow", Action: "sts:AssumeRoleWithWebIdentity",
              Principal: { Federated: { "Fn::If": ["ProvisionProvider", { Ref: "FactorizeProvider" }, provider] } },
              Condition: { StringEquals: { [issuerKey + ":aud"]: awsAudience, [issuerKey + ":sub"]: awsSubject(connectionId) } },
            }],
          },
          Policies: [{ PolicyName: "FactorizeCodeModeStarter", PolicyDocument: starterPolicy }],
        },
      },
    },
    Outputs: { RoleArn: { Value: { "Fn::GetAtt": ["FactorizeRole", "Arn"] }, Description: "Paste this role ARN into your Factorize connection." } },
  };
}
