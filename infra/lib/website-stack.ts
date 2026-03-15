import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import * as path from 'path';

export class WebsiteStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ── Static asset bucket ───────────────────────────────────────────────
        const staticBucket = new s3.Bucket(this, 'StaticAssets', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // ── Lambda function ───────────────────────────────────────────────────
        // The deploy workflow runs:
        //   hadars export lambda lambda.mjs   (in website/)
        //   mkdir -p website/lambda-deploy && cp website/lambda.mjs website/lambda-deploy/
        //
        // The resulting lambda.mjs is a fully self-contained ESM bundle —
        // no node_modules required in the deployment package.
        const ssrHandler = new lambda.Function(this, 'SsrHandler', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'lambda.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../website/lambda-deploy'),
            ),
            memorySize: 512,
            timeout: cdk.Duration.seconds(30),
            description: 'hadars SSR handler',
        });

        const fnUrl = ssrHandler.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
        });

        // ── CloudFront origins ────────────────────────────────────────────────
        const lambdaOrigin = new origins.FunctionUrlOrigin(fnUrl);
        const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticBucket);

        // Static asset behavior: long-lived cache, served from S3.
        // All hadars output files have content-hashed names so cache can be
        // aggressive — a new deploy uploads new files and invalidates CloudFront.
        const staticBehavior: cloudfront.BehaviorOptions = {
            origin: s3Origin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            compress: true,
        };

        // ── CloudFront distribution ───────────────────────────────────────────
        const distribution = new cloudfront.Distribution(this, 'Distribution', {
            defaultBehavior: {
                // All dynamic (HTML) requests go to the Lambda function URL.
                origin: lambdaOrigin,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                // Disable caching for SSR responses — each request is rendered live.
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                // Forward all headers / query strings to Lambda (needed for
                // cookies, Accept: application/json, etc.).
                originRequestPolicy:
                    cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            },
            // Route static file extensions to S3 instead of Lambda.
            additionalBehaviors: {
                '*.js':   staticBehavior,
                '*.css':  staticBehavior,
                '*.map':  staticBehavior,
                '*.ico':  staticBehavior,
                '*.png':  staticBehavior,
                '*.jpg':  staticBehavior,
                '*.jpeg': staticBehavior,
                '*.gif':  staticBehavior,
                '*.svg':  staticBehavior,
                '*.webp': staticBehavior,
                '*.woff':  staticBehavior,
                '*.woff2': staticBehavior,
                '*.ttf':  staticBehavior,
            },
            // US + Europe — change to PRICE_CLASS_ALL for global.
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            comment: 'hadars website',
        });

        // ── Deploy static assets to S3 ────────────────────────────────────────
        // Uploads the contents of website/.hadars/static/ to the S3 bucket and
        // invalidates the CloudFront distribution on every deploy.
        new s3deploy.BucketDeployment(this, 'DeployStatic', {
            sources: [
                s3deploy.Source.asset(
                    path.join(__dirname, '../../website/.hadars/static'),
                ),
            ],
            destinationBucket: staticBucket,
            distribution,
            distributionPaths: ['/*'],
        });

        // ── Outputs ───────────────────────────────────────────────────────────
        new cdk.CfnOutput(this, 'CloudFrontUrl', {
            value: `https://${distribution.distributionDomainName}`,
            description: 'CloudFront distribution URL',
        });
        new cdk.CfnOutput(this, 'StaticBucketName', {
            value: staticBucket.bucketName,
            description: 'S3 bucket for static assets',
        });
        new cdk.CfnOutput(this, 'LambdaFunctionUrl', {
            value: fnUrl.url,
            description: 'Lambda function URL (fronted by CloudFront, not for direct use)',
        });
    }
}
