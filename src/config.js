import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized configuration for all extractors
 */
export const config = {
    // Database configuration
    database: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'uw_madison_data',
        port: parseInt(process.env.DB_PORT) || 3306
    },

    // API configurations
    apis: {
        madgrades: {
            baseUrl: 'https://api.madgrades.com/v1',
            token: process.env.MADGRADES_API_TOKEN || 'db0b773feba0467688172d87b38f3f95',
            perPage: 500,
            batchSize: 100
        },
        courseSearch: {
            baseUrl: 'https://api.wisc.edu/course-search-and-enroll/v1', // Replace with actual URL
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Content-Type": "application/json",
                "Authorization": "Basic dGVzdDp0ZXN0",
                "Sec-GPC": "1"
            }
        },
        rateMyProfessor: {
            baseUrl: 'https://www.ratemyprofessors.com/graphql',
            schoolId: 'U2Nob29sLTE4NDI=', // UW-Madison ID
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Content-Type": "application/json",
                "Authorization": "Basic dGVzdDp0ZXN0",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Priority": "u=4"
            }
        }
    },

    // Rate limiting
    rateLimiting: {
        delay: parseInt(process.env.RATE_LIMIT_DELAY) || 100, // milliseconds
        batchSize: parseInt(process.env.BATCH_SIZE) || 50,
        maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
        backoffMultiplier: 2
    },

    // Development settings
    development: {
        testMode: process.env.NODE_ENV === 'development',
        testCourseLimit: 50,
        useMockData: false,
        useTestTables: false,
        testTablePrefix: 'test_',
        skipSections: false,
        verboseLogging: process.env.DEBUG === 'true'
    },

    // File paths
    paths: {
        data: './data',
        csv: './data/csv',
        sql: './data/sql',
        logs: './logs',
        temp: './temp'
    },

    // Data validation rules
    validation: {
        course: {
            requiredFields: ['courseId', 'subject', 'title'],
            maxTitleLength: 200,
            maxDescriptionLength: 2000
        },
        section: {
            requiredFields: ['sectionId', 'courseId'],
            maxCapacity: 1000
        },
        teacher: {
            requiredFields: ['firstName', 'lastName'],
            maxNameLength: 100
        }
    },

    // Output formats
    output: {
        dateFormat: 'YYYY-MM-DD',
        timestampFormat: 'YYYY-MM-DD_HH-mm-ss',
        csvDelimiter: ',',
        csvEncoding: 'utf8'
    }
};

/**
 * Get configuration for specific extractor
 */
export function getExtractorConfig(extractorName) {
    const baseConfig = {
        database: config.database,
        rateLimiting: config.rateLimiting,
        development: config.development,
        paths: config.paths,
        output: config.output
    };

    switch (extractorName) {
        case 'madgrades':
            return {
                ...baseConfig,
                api: config.apis.madgrades,
                validation: config.validation.course
            };
        
        case 'courses':
            return {
                ...baseConfig,
                api: config.apis.courseSearch,
                validation: {
                    course: config.validation.course,
                    section: config.validation.section
                }
            };
        
        case 'rmp':
            return {
                ...baseConfig,
                api: config.apis.rateMyProfessor,
                validation: config.validation.teacher
            };
        
        default:
            return baseConfig;
    }
}

/**
 * Validate configuration
 */
export function validateConfig() {
    const required = [
        'database.host',
        'database.user',
        'database.name'
    ];

    for (const path of required) {
        const value = path.split('.').reduce((obj, key) => obj?.[key], config);
        if (!value) {
            throw new Error(`Missing required configuration: ${path}`);
        }
    }

    return true;
}

export default config;
