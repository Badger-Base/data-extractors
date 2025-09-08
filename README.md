# UW-Madison Data Extractors

A comprehensive data extraction system for UW-Madison that collects and processes academic data from multiple sources including MadGrades, Course Search & Enroll system, and Rate My Professor.

## 📁 Project Structure

```
data-extractors/
├── src/
│   ├── extractors/          # Main data extraction modules
│   │   ├── madgrades_extractor.js
│   │   ├── course_search_and_enroll_extractor.js
│   │   └── rmp-extractor.js
│   ├── preprocessors/       # Data cleaning and preprocessing
│   │   └── rmp_preprocessor.py
│   └── utils/              # Utility functions and database tools
│       └── run_dumps.js
├── data/                   # Extracted and processed data
│   ├── csv/               # CSV output files
│   └── sql/               # SQL dump files
├── tests/                 # Test files
├── scripts/              # Automation and deployment scripts
├── package.json          # Node.js dependencies
└── README.md             # This file
```

## 🔧 Features

### Data Sources
- **MadGrades API**: Historical grade data for UW-Madison courses
- **Course Search & Enroll**: Current course listings, sections, and enrollment data
- **Rate My Professor**: Faculty ratings and reviews

### Extractors

#### 1. MadGrades Extractor (`madgrades_extractor.js`)
- Fetches comprehensive grade data for all UW-Madison courses
- Calculates cumulative and most recent GPAs
- Provides grade distribution percentages (A, AB, B, BC, C, D, F)
- Includes median grade calculations
- **Output**: Grade statistics with course UUIDs

#### 2. Course Search & Enroll Extractor (`course_search_and_enroll_extractor.js`)
- Extracts current course catalog information
- Collects section details including instructors, schedules, and enrollment status
- Supports both test and production modes
- Rate-limited API calls to prevent blocking
- **Features**:
  - Mock data support for testing
  - Configurable batch processing
  - Comprehensive error handling
  - Development configuration options

#### 3. Rate My Professor Extractor (`rmp-extractor.js`)
- Scrapes faculty ratings from Rate My Professor
- Collects average ratings, difficulty scores, and "would take again" percentages
- Handles pagination for complete data collection
- **Output**: Faculty ratings with department information

### Preprocessors

#### RMP Preprocessor (`rmp_preprocessor.py`)
- Cleans and standardizes Rate My Professor data
- Fuzzy string matching for name normalization
- Department mapping and standardization
- **Features**:
  - Name variation handling
  - Department code standardization
  - Data quality improvements

### Utilities

#### Database Utility (`run_dumps.js`)
- Executes SQL dump files against MySQL database
- Supports multiple statement execution
- Environment variable configuration
- **Usage**: `node src/utils/run_dumps.js <sql_file_path>`

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- Python 3.x (for preprocessing)
- MySQL database (for data storage)

### Installation

1. **Clone and navigate to the project**:
   ```bash
   cd data-extractors
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Install Python dependencies** (for preprocessing):
   ```bash
   pip install pandas fuzzywuzzy tqdm
   ```

4. **Set up environment variables**:
   Create a `.env` file with:
   ```env
   DB_HOST=your_database_host
   DB_USER=your_database_user
   DB_PASSWORD=your_database_password
   DB_NAME=your_database_name
   DB_PORT=your_database_port
   ```

### Running the Extractors

#### MadGrades Data Extraction
```bash
node src/extractors/madgrades_extractor.js
```

#### Course & Enrollment Data Extraction
```bash
# Production mode
node src/extractors/course_search_and_enroll_extractor.js

# Test mode (modify DEV_CONFIG in the file)
```

#### Rate My Professor Data Extraction
```bash
node src/extractors/rmp-extractor.js
```

#### Data Preprocessing
```bash
python src/preprocessors/rmp_preprocessor.py
```

#### Database Operations
```bash
node src/utils/run_dumps.js data/sql/your_dump_file.sql
```

## 📊 Data Output

### CSV Files (in `data/csv/`)
- `uw_madison_courses.csv`: Course catalog data
- `uw_madison_sections.csv`: Section and enrollment information
- `madison_teachers_*.csv`: Rate My Professor data
- `processed_rmp_data.csv`: Cleaned RMP data

### SQL Files (in `data/sql/`)
- Database dump files for importing into MySQL
- Structured data ready for analysis

## ⚙️ Configuration

### Development Settings
The Course Search & Enroll extractor includes development configuration options:

```javascript
const DEV_CONFIG = {
    TEST_MODE: false,           // Enable for testing with limited data
    TEST_COURSE_LIMIT: 50,      // Number of courses in test mode
    USE_MOCK_DATA: false,       // Use mock data instead of API calls
    USE_TEST_TABLES: false,     // Create separate test database tables
    SKIP_SECTIONS: false,       // Skip section data extraction
    VERBOSE_LOGGING: true       // Enable detailed logging
};
```

### Rate Limiting
- Configurable delays between API requests
- Batch processing to manage load
- Retry mechanisms for failed requests

## 🔍 API Keys and Authentication

- **MadGrades**: Requires API token (configured in extractor)
- **Course Search & Enroll**: Uses basic authentication
- **Rate My Professor**: Web scraping (no authentication required)

## 📈 Data Quality

- Comprehensive error handling and logging
- Data validation and cleaning
- Fuzzy matching for name standardization
- Duplicate detection and removal

## 🤝 Contributing

1. Follow the established directory structure
2. Add comprehensive error handling
3. Include logging for debugging
4. Test with small datasets before full runs
5. Document any new configuration options

## 📄 License

This project is for academic and research purposes related to UW-Madison data analysis.

## ⚠️ Important Notes

- **Rate Limiting**: Be respectful of API rate limits to avoid blocking
- **Data Privacy**: Ensure compliance with data usage policies
- **Testing**: Always test with small datasets before full extraction runs
- **Database**: Ensure sufficient storage space for large datasets

## 📞 Support

For issues or questions related to:
- MadGrades API: Check API documentation
- Course data: Verify UW-Madison system status
- Database issues: Check connection settings and permissions
