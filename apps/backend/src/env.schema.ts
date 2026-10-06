import * as Joi from 'joi';

const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  PORT: Joi.number().port().default(3001),
  FRONTEND_ORIGIN: Joi.string().uri().default('http://localhost:3000'),
  API_PUBLIC_URL: Joi.string().uri().default('http://localhost:3001/api'),
  APP_VERSION: Joi.string().empty('').default('0.1.0'),
  APP_COMMIT_SHA: Joi.string().empty('').optional(),
  APP_BUILD_TIME: Joi.string().isoDate().empty('').optional(),
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().min(16).default('signa-development-secret'),
  }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  REGISTRATION_MODE: Joi.string()
    .valid('open', 'initial_only', 'disabled')
    .default('initial_only'),

  DATABASE_TYPE: Joi.string().valid('postgres', 'sqlite').empty('').optional(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .optional(),
  DATABASE_HOST: Joi.string().allow('').optional(),
  DATABASE_PORT: Joi.number().port().empty('').default(5432),
  DATABASE_USER: Joi.string().default('postgres'),
  DATABASE_PASSWORD: Joi.string().allow('').default('postgres'),
  DATABASE_NAME: Joi.string().default('signa_development'),
  DATABASE_SSL: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .default(false),
  DATABASE_LOGGING: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .default(false),
  DATABASE_MIGRATIONS_RUN: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .default(false),
  SQLITE_DATABASE_PATH: Joi.string().default('data/signa.sqlite'),
  SQLITE_SYNCHRONIZE: Joi.boolean().truthy('true').falsy('false').default(true),

  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .allow('')
    .optional(),
  CACHE_NAMESPACE: Joi.string().default('signa-cache'),
  CACHE_TTL_MS: Joi.number().integer().min(0).default(3_600_000),

  QUEUE_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  QUEUE_REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .allow('')
    .optional(),
  QUEUE_PREFIX: Joi.string().default('signa'),
  QUEUE_DEFAULT_ATTEMPTS: Joi.number().integer().min(1).default(3),
  QUEUE_BACKOFF_MS: Joi.number().integer().min(0).default(5000),
  QUEUE_REMOVE_ON_COMPLETE: Joi.number().integer().min(0).default(1000),
  QUEUE_REMOVE_ON_FAIL: Joi.number().integer().min(0).default(5000),

  BULL_BOARD_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  BULL_BOARD_ROUTE: Joi.string().default('/queues'),
  BULL_BOARD_USER: Joi.string().default('admin'),
  BULL_BOARD_PASS: Joi.when('BULL_BOARD_ENABLED', {
    is: true,
    then: Joi.string().min(12).required(),
    otherwise: Joi.string().default('change-me'),
  }),

  MAIL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  MAIL_HOST: Joi.string().default('localhost'),
  MAIL_PORT: Joi.number().port().default(1025),
  MAIL_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  MAIL_AUTH_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  MAIL_USER: Joi.when('MAIL_AUTH_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_PASS: Joi.when('MAIL_AUTH_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_FROM_NAME: Joi.string().default('Signa'),
  MAIL_FROM_ADDRESS: Joi.string().email().default('no-reply@signa.com'),
  MAIL_REPLY_TO: Joi.string().email().allow('').optional(),
  MAIL_TEMPLATE_DIR: Joi.string().allow('').optional(),
  MAIL_LOGO_URL: Joi.string().uri().allow('').optional(),
  MAIL_ASSET_BASE_URL: Joi.string().uri().allow('').optional(),
  MAIL_CALLBACK_SECRET: Joi.string().allow('').optional(),
  MAIL_TLS_REJECT_UNAUTHORIZED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  SMTP_ADDRESS: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().port().empty('').optional(),
  SMTP_DOMAIN: Joi.string().allow('').optional(),
  SMTP_USERNAME: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  SMTP_AUTHENTICATION: Joi.string().allow('').optional(),
  SMTP_FROM: Joi.string().allow('').optional(),
  SMTP_REPLY_TO: Joi.string().email().allow('').optional(),
  SMTP_ENABLE_STARTTLS: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .optional(),
  SMTP_ENABLE_SSL: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .optional(),
  SMTP_ENABLE_TLS: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .optional(),
  SMTP_SSL_VERIFY: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .empty('')
    .optional(),
  SMTP_OPEN_TIMEOUT: Joi.number().integer().min(1).empty('').optional(),
  SMTP_READ_TIMEOUT: Joi.number().integer().min(1).empty('').optional(),
  GOOGLE_AUTH_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_AUTH_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_AUTH_REDIRECT_URI: Joi.string().uri().allow('').optional(),
  GMAIL_OAUTH_CLIENT_ID: Joi.string().allow('').optional(),
  GMAIL_OAUTH_CLIENT_SECRET: Joi.string().allow('').optional(),
  GMAIL_OAUTH_REDIRECT_URI: Joi.string().uri().allow('').optional(),

  WEBHOOK_TIMEOUT_MS: Joi.number().integer().min(1000).default(10_000),
  WEBHOOK_MAX_ATTEMPTS: Joi.number().integer().min(1).default(8),
  WEBHOOK_BACKOFF_MS: Joi.number().integer().min(1000).default(30_000),

  STORAGE_SERVICE: Joi.string().valid('auto', 'local', 's3').default('auto'),
  STORAGE_PATH: Joi.string().default('storage'),
  AWS_REGION: Joi.string().allow('').optional(),
  AWS_DEFAULT_REGION: Joi.string().allow('').optional(),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_SESSION_TOKEN: Joi.string().allow('').optional(),
  S3_ATTACHMENTS_BUCKET: Joi.string().allow('').optional(),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),
  AWS_S3_PREFIX: Joi.string().allow('').default(''),
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  AWS_S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  AWS_S3_FORCE_PATH_STYLE: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  AWS_S3_SERVER_SIDE_ENCRYPTION: Joi.string()
    .valid('AES256', 'aws:kms')
    .allow('')
    .optional(),
  ATTACHMENT_INGEST_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(10 * 1024 * 1024),
  PDF_PREVIEW_MAX_PAGES: Joi.number().integer().min(1).default(15),
  PDF_PREVIEW_MAX_WIDTH: Joi.number().integer().min(300).default(1400),
  SIGNING_KEY_ENCRYPTION_KEY: Joi.string()
    .pattern(/^[a-fA-F0-9]{64}$/)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  PDF_TSA_TRUST_CERTIFICATES: Joi.string().allow('').default(''),
  PDF_REQUIRE_TRUSTED_SIGNER: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().default(true),
      otherwise: Joi.boolean().default(false),
    }),
  PDF_SIGNATURE_SUBFILTER: Joi.string()
    .valid('pades', 'adobe')
    .default('pades'),
  PDF_TIMESTAMP_REQUIRED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().default(true),
      otherwise: Joi.boolean().default(false),
    }),
  PDF_TIMESTAMP_TIMEOUT_MS: Joi.number().integer().min(1000).default(10_000),
  PDF_LTV_REQUIRED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.boolean().default(true),
      otherwise: Joi.boolean().default(false),
    }),
  PDF_LTV_HTTP_TIMEOUT_MS: Joi.number().integer().min(1000).default(10_000),
  PDF_A_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  PDF_A_REQUIRED: Joi.boolean().truthy('true').falsy('false').default(false),
  PDF_A_LEVEL: Joi.string().valid('1b', '2b', '3b').default('2b'),
  PDF_A_GHOSTSCRIPT_PATH: Joi.string().default('gs'),
  PDF_A_VERAPDF_PATH: Joi.string().default('verapdf'),
  PDF_A_TIMEOUT_MS: Joi.number().integer().min(1000).default(60_000),
  DOCUMENT_CONVERSION_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(15 * 1024 * 1024),
  HTML_TO_PDF_TIMEOUT_MS: Joi.number().integer().min(1000).default(30_000),
  HEALTH_HEAP_LIMIT_MB: Joi.number().integer().min(64).default(512),
  HEALTH_REDIS_REQUIRED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  HEALTH_REDIS_TIMEOUT_MS: Joi.number().integer().min(100).default(1000),
  API_HEALTH_WINDOW_MS: Joi.number().integer().min(60_000).default(300_000),
  API_SLOW_REQUEST_WARN_MS: Joi.number().integer().min(1).default(1000),
  API_HEALTH_P95_DEGRADED_MS: Joi.number().integer().min(1).default(1000),
  API_HEALTH_ERROR_RATE_DEGRADED_PERCENT: Joi.number()
    .min(0)
    .max(100)
    .default(5),
  API_HEALTH_MIN_REQUEST_COUNT: Joi.number().integer().min(1).default(20),

  THROTTLE_TTL_MS: Joi.number().integer().min(1_000).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(120),

  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_VERIFY_SERVICE_SID: Joi.string().allow('').optional(),
  TWILIO_MESSAGING_SERVICE_SID: Joi.string().allow('').optional(),
  TWILIO_FROM_PHONE: Joi.string().allow('').optional(),
  SMS_CALLBACK_SECRET: Joi.string().allow('').optional(),
});

export default validationSchema;
