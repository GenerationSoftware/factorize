export const awsIssuerPath = "/oauth/aws";
export const awsAudience = "sts.amazonaws.com";
const awsMcpPrincipal = "aws-mcp.amazonaws.com";

export const awsRegions = ["us-east-1", "us-west-2", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "eu-central-1", "eu-west-1", "eu-west-2"] as const;
export type AwsRegion = typeof awsRegions[number];

export const awsOperations = {
  lambda: { permission: "lambda:ListFunctions", operation: "ListFunctions", params: '{"MaxItems":25}', collection: "Functions", identifier: "FunctionName", truncated: "NextMarker" },
  ec2: { permission: "ec2:DescribeInstances", operation: "DescribeInstances", params: '{"MaxResults":25}', collection: "Reservations", identifier: "InstanceId", truncated: "NextToken" },
  cloudfront: { permission: "cloudfront:ListDistributions", operation: "ListDistributions", params: '{"MaxItems":"25"}', collection: "DistributionList", identifier: "Id", truncated: "IsTruncated" },
} as const;
export const awsServices = ["lambda", "ec2", "cloudfront"] as const;
export type AwsService = typeof awsServices[number];
export type AwsInventory = { service: AwsService; region: AwsRegion; identifiers: string[]; truncated: boolean };

export const awsSubject = (id: string) => "factorize-aws:" + id;
export const awsInventoryPolicy = {
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow", Action: Object.values(awsOperations).map(op => op.permission), Resource: "*",
    Condition: { StringEquals: { "aws:CalledViaAWSMCP": awsMcpPrincipal } },
  }],
};

export function awsRoleTemplate(issuer: string, connectionId: string) {
  const issuerKey = new URL(issuer).host + awsIssuerPath;
  const provider = { "Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/" + issuerKey };
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Allow one Factorize connection to list Lambda functions, EC2 instances and CloudFront distributions through AWS MCP.",
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
          Policies: [{ PolicyName: "FactorizeReadOnlyInventory", PolicyDocument: awsInventoryPolicy }],
        },
      },
    },
    Outputs: { RoleArn: { Value: { "Fn::GetAtt": ["FactorizeRole", "Arn"] }, Description: "Paste this role ARN into your Factorize connection." } },
  };
}
