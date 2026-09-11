import { defineTool, annotations } from '../../core/registry.js';
import { generateShareUrlSchema, getS3CredentialsSchema, shareAccessSchema, serializeAccessSchema } from './schema.js';
import { generateShareUrl, getS3Credentials, shareAccess, serializeAccess } from './handlers.js';

export const tools = [
  defineTool({
    name: 'generate_share_url',
    annotations: annotations.creates,
    description: 'Generate a public shareable URL for a Storj object using Storj Edge linkshare service. Optionally set an expiry.',
    schema: generateShareUrlSchema,
    handler: generateShareUrl,
  }),
  defineTool({
    name: 'get_s3_credentials',
    annotations: annotations.creates,
    description:
      'Issue S3-compatible credentials (access key, secret, endpoint) for use with rclone, aws-cli, or any S3 SDK. ' +
      'Scoped to one bucket/prefix with least-privilege permissions (read-only by default) and an optional expiry. ' +
      'The secret key is sensitive — handle with care.',
    schema: getS3CredentialsSchema,
    handler: getS3Credentials,
  }),
  defineTool({
    name: 'share_access',
    annotations: annotations.creates,
    description: 'Create a restricted, serialized Storj access grant with specific permissions (download/upload/list/delete), optionally scoped to a bucket prefix and with an expiry time',
    schema: shareAccessSchema,
    handler: shareAccess,
  }),
  defineTool({
    name: 'serialize_access',
    annotations: annotations.readOnly,
    description: 'Serialize the current Storj access grant to a string that can be shared or stored',
    schema: serializeAccessSchema,
    handler: serializeAccess,
  }),
];
