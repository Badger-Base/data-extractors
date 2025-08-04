
import pandas as pd
import re
from fuzzywuzzy import fuzz, process
from fuzzywuzzy.utils import full_process
import csv
from tqdm import tqdm  # For progress bars

class RMPPreprocessor:
    
    def __init__(self):
        self.name_variations = {}
        self.department_mappings = {
            'Computer Science': ['CS', 'COMP SCI', 'Computer Sciences'],
            'Mathematics': ['Math', 'MATH', 'Statistics', 'STAT'],
            'Economics': ['Econ', 'ECON'],
            'Zoology': ['ZOOL'],
            'Biology': ['BIO', 'BIOL'],
            'Chemistry': ['CHEM'],
            'Physics': ['PHYS'],
            'English': ['ENGL'],
            'History': ['HIST'],
            'Political Science': ['POL SCI'],
            'Psychology': ['PSYCH'],    
            'Sociology': ['SOC'],
            'Anthropology': ['ANTH'],
            'Philosophy': ['PHIL'],
            'Religious Studies': ['REL'],
            'Art History': ['ART HIS'],
            'Music': ['MUSIC'],
            'Theater': ['THEAT'],
            'German': ['GERMAN'],
            'French': ['FRENCH'],
            'Spanish': ['SPANISH'],
            'Italian': ['ITALIAN'],
            'Japanese': ['JAPANESE'],
            'Korean': ['KOREAN'],
            'Chinese': ['CHINESE'], 
            'Finance': ['FINANCE'],
            'Accounting': ['ACCOUNTING'],
            'Management': ['MANAGEMENT'],
            'Marketing': ['MARKETING'],
            'Business': ['BUSINESS'],
            'International Business': ['INTL BUS'],
            'International Studies': ['INTL STUDIES'],
            'International Relations': ['INTL RELATIONS'],
            'International Economics': ['INTL ECON'],
            'International Finance': ['INTL FINANCE'],
            'International Accounting': ['INTL ACCOUNTING'],
            'International Management': ['INTL MANAGEMENT'],
            'Business Administration': ['BUS ADM'],
        }
    
    def clean_name(self, name):
        """Clean and standardize a name string"""
        if pd.isna(name) or not name:
            return ""
        
        # Remove extra whitespace
        name = re.sub(r'\s+', ' ', name.strip())
        
        # Handle parenthetical nicknames like "Debra (Deb)" -> "Debra Deb"
        name = re.sub(r'\s*\([^)]+\)\s*', ' ', name)
        
        # Remove common title prefixes
        name = re.sub(r'^(Dr\.?|Professor|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+', '', name, flags=re.IGNORECASE)
        
        # Remove trailing periods and commas
        name = re.sub(r'[.,]+$', '', name)
        
        # Standardize multiple spaces
        name = re.sub(r'\s+', ' ', name).strip()
        
        return name
    
    def extract_names_from_instructors_field(self, instructors_text):
        """Extract individual instructor names from the instructors field"""
        if pd.isna(instructors_text) or not instructors_text:
            return []
        
        # Split by comma and clean each name
        names = []
        for name in instructors_text.split(','):
            cleaned = self.clean_name(name.strip())
            if cleaned:
                names.append(cleaned)
        return names
    
    def create_name_variations(self, name):
        """Create variations of a name for better matching"""
        variations = set()
        cleaned = self.clean_name(name)
        
        if not cleaned:
            return variations
        
        # Add the cleaned version
        variations.add(cleaned)
        
        # Split into parts
        parts = cleaned.split()
        if len(parts) >= 2:
            first_name = parts[0]
            last_name = parts[-1]
            
            # Add "First Last" format
            variations.add(f"{first_name} {last_name}")
            
            # Add "Last, First" format
            variations.add(f"{last_name}, {first_name}")
            
            # Add middle names if present
            if len(parts) > 2:
                middle_parts = parts[1:-1]
                # Add "First Middle Last"
                variations.add(f"{first_name} {' '.join(middle_parts)} {last_name}")
                
                # Add "First M Last" (first letter of middle names)
                middle_initials = ' '.join([p[0] + '.' for p in middle_parts if p])
                variations.add(f"{first_name} {middle_initials} {last_name}")
        
        return variations

    
    def preprocess_rmp_data(self, rmp_df, course_df=None):
        """
        Preprocess RMP data to standardize names for better joining
        
        Args:
            rmp_df: DataFrame with RMP data
            course_df: Optional DataFrame with course data for reference matching
        
        Returns:
            DataFrame with additional columns for standardized names
        """
        print("Starting RMP data preprocessing...")
        
        # Make a copy to avoid modifying original
        processed_df = rmp_df.copy()
        
        print("Cleaning names...")
        # Clean the original first and last names
        processed_df['CleanedFirstName'] = processed_df['FirstName'].apply(self.clean_name)
        processed_df['CleanedLastName'] = processed_df['LastName'].apply(self.clean_name)
        
        # Create standardized full name (single field like course data)
        processed_df['instructors'] = processed_df.apply(
            lambda row: f"{row['CleanedFirstName']} {row['CleanedLastName']}" 
            if row['CleanedFirstName'] and row['CleanedLastName'] else "", 
            axis=1
        )
        
        print("Creating name variations...")
        # Create alternative name formats for matching
        processed_df['NameVariations'] = processed_df['instructors'].apply(
            lambda name: list(self.create_name_variations(name))
        )
        
        # If course data is provided, try to find best matches
        if course_df is not None:
            print("Starting fuzzy matching (this is the slow part)...")
            processed_df = self.find_best_matches_optimized(processed_df, course_df)
        
        return processed_df
    
    def find_best_matches_optimized(self, rmp_df, course_df):
        """Optimized version with progress tracking and early exits"""
        print("Extracting instructor names from course data...")
        
        # Extract all instructor names from course data
        all_course_instructors = set()
        
        # Use tqdm for progress on course data processing
        for instructors in tqdm(course_df['instructors'].dropna(), desc="Processing course data"):
            names = self.extract_names_from_instructors_field(instructors)
            all_course_instructors.update(names)
        
        all_course_instructors = list(all_course_instructors)
        print(f"Found {len(all_course_instructors)} unique instructor names in course data")
        
        # Find best matches for each RMP entry with progress bar
        best_matches = []
        match_scores = []
        
        print("Performing fuzzy matching...")
        for idx, row in tqdm(rmp_df.iterrows(), total=len(rmp_df), desc="Matching RMP records"):
            name_to_match = row['instructors']
            
            if not name_to_match:
                best_matches.append("")
                match_scores.append(0)
                continue
            
            # Try fuzzy matching with all variations
            best_match = ""
            best_score = 0
            
            # Check all name variations - stop early if we find a perfect match
            for variation in row['NameVariations']:
                if variation:
                    # Check for exact match first (much faster)
                    if variation in all_course_instructors:
                        best_match = variation
                        best_score = 100
                        break
                    
                    # Otherwise do fuzzy matching
                    match = process.extractOne(
                        variation, 
                        all_course_instructors, 
                        scorer=fuzz.token_sort_ratio,
                        score_cutoff=80
                    )
                    
                    if match and match[1] > best_score:
                        best_match = match[0]
                        best_score = match[1]
                        
                        # If we get a very high score, we can stop looking
                        if best_score >= 95:
                            break
            
            best_matches.append(best_match)
            match_scores.append(best_score)
        
        rmp_df['BestCourseMatch'] = best_matches
        rmp_df['MatchScore'] = match_scores
        
        return rmp_df
    
    def export_processed_data(self, processed_df, output_file='processed_rmp_data.csv'):
        """Export the processed data to CSV"""
        # Select columns for output
        output_columns = [
            'ID', 'LegacyID', 'FirstName', 'LastName', 'Department',
            'AvgRating', 'NumRatings', 'AvgDifficulty', 'WouldTakeAgainPercent',
            'CleanedFirstName', 'CleanedLastName', 'instructors'
        ]
        
        # Add match columns if they exist
        if 'BestCourseMatch' in processed_df.columns:
            output_columns.extend(['BestCourseMatch', 'MatchScore'])
        
        processed_df[output_columns].to_csv(output_file, index=False)
        print(f"Processed data exported to {output_file}")
        
        # Print some statistics
        if 'MatchScore' in processed_df.columns:
            high_confidence = len(processed_df[processed_df['MatchScore'] >= 90])
            medium_confidence = len(processed_df[(processed_df['MatchScore'] >= 80) & (processed_df['MatchScore'] < 90)])
            low_confidence = len(processed_df[processed_df['MatchScore'] < 80])
            
            print(f"\nMatching Statistics:")
            print(f"High confidence matches (>=90%): {high_confidence}")
            print(f"Medium confidence matches (80-89%): {medium_confidence}")
            print(f"Low confidence matches (<80%): {low_confidence}")
            

def generate_sql_dump(processed_df, output_file='rmp_cleaned.sql'):
    """
    Generate a SQL dump file from the processed RMP data with batched inserts.
    
    Args:
        processed_df: DataFrame with processed RMP data
        output_file: Path to output SQL file
    """
    # Select the columns we want to include
    columns_to_export = [
        'ID', 'LegacyID', 'CleanedFirstName', 'CleanedLastName', 'instructors',
        'Department', 'AvgRating', 'NumRatings', 'AvgDifficulty', 
        'WouldTakeAgainPercent'
    ]
    
    # Filter the DataFrame
    export_df = processed_df[columns_to_export].copy()
    
    # Rename columns to match SQL schema
    export_df = export_df.rename(columns={
        'CleanedFirstName': 'first_name',
        'CleanedLastName': 'last_name',
        'instructors': 'full_name',
        'Department': 'department',
        'AvgRating': 'avg_rating',
        'NumRatings': 'num_ratings',
        'AvgDifficulty': 'avg_difficulty',
        'WouldTakeAgainPercent': 'would_take_again_percent'
    })
    
    # Handle NaN values
    export_df = export_df.fillna({
        'LegacyID': 'NULL',
        'first_name': 'NULL',
        'last_name': 'NULL',
        'full_name': 'NULL',
        'department': 'NULL',
        'avg_rating': 'NULL',
        'num_ratings': 'NULL',
        'avg_difficulty': 'NULL',
        'would_take_again_percent': 'NULL'
    })
    
    # Create SQL header
    sql_header = """-- RateMyProfessors Cleaned Data Dump
-- Generated from processed RMP data
-- Excludes original first/last names, only includes cleaned versions

DROP TABLE IF EXISTS rmp_cleaned;

CREATE TABLE rmp_cleaned (
    id VARCHAR(255) PRIMARY KEY,
    legacy_id VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    full_name VARCHAR(200),
    department VARCHAR(100),
    avg_rating FLOAT,
    num_ratings INT,
    avg_difficulty FLOAT,
    would_take_again_percent FLOAT
);

-- Batch inserts of 500 records each
"""
    
    # Write to the SQL file
    with open(output_file, 'w') as f:
        f.write(sql_header)
        
        total_records = len(export_df)
        batch_size = 500
        num_batches = (total_records // batch_size) + 1
        
        print(f"Generating SQL dump with {total_records} records in {num_batches} batches...")
        
        for batch_num in tqdm(range(num_batches), desc="Generating SQL batches"):
            start_idx = batch_num * batch_size
            end_idx = start_idx + batch_size
            batch_df = export_df.iloc[start_idx:end_idx]
            
            if len(batch_df) == 0:
                continue
                
            f.write("\nINSERT INTO rmp_cleaned (id, legacy_id, first_name, last_name, full_name, department, avg_rating, num_ratings, avg_difficulty, would_take_again_percent) VALUES\n")
            
            rows = []
            for _, row in batch_df.iterrows():
                # Format values appropriately - FIXED: Added quotes around ID
                values = [
                    f"'{str(row['ID'])}'" if pd.notna(row['ID']) else 'NULL',  # Added quotes around ID
                    f"'{str(row['LegacyID'])}'" if pd.notna(row['LegacyID']) and row['LegacyID'] != 'NULL' else 'NULL',
                    f"'{row['first_name'].replace("'", "''")}'" if row['first_name'] != 'NULL' else 'NULL',
                    f"'{row['last_name'].replace("'", "''")}'" if row['last_name'] != 'NULL' else 'NULL',
                    f"'{row['full_name'].replace("'", "''")}'" if row['full_name'] != 'NULL' else 'NULL',
                    f"'{row['department'].replace("'", "''")}'" if row['department'] != 'NULL' else 'NULL',
                    str(row['avg_rating']) if pd.notna(row['avg_rating']) else 'NULL',
                    str(int(row['num_ratings'])) if pd.notna(row['num_ratings']) else 'NULL',
                    str(row['avg_difficulty']) if pd.notna(row['avg_difficulty']) else 'NULL',
                    str(row['would_take_again_percent']) if pd.notna(row['would_take_again_percent']) else 'NULL'
                ]
                rows.append(f"    ({', '.join(values)})")
            
            f.write(",\n".join(rows) + ";\n")
        
        f.write("\n-- End of SQL dump\n")
    
    print(f"SQL dump successfully created at {output_file}")


# Usage example with progress tracking
def main():
    # Initialize preprocessor
    preprocessor = RMPPreprocessor()
    
    # Load your data
    try:
        # Load RMP data
        print("Loading data files...")
        rmp_df = pd.read_csv('uw_madison_teachers_2025-07-14.csv')
        print(f"Loaded {len(rmp_df)} RMP records")
        
        # Load course data (optional)
        try:
            course_df = pd.read_csv('uw_madison_sections.csv')
            print(f"Loaded {len(course_df)} course records")
        except FileNotFoundError:
            print("Course data not found, proceeding without reference matching")
            course_df = None
        
        # Preprocess the data
        processed_df = preprocessor.preprocess_rmp_data(rmp_df, course_df)

        # Generate SQL dump
        generate_sql_dump(processed_df)
        
        # Show some examples
        print("\nExample processed records:")
        example_cols = ['FirstName', 'LastName', 'instructors']
        if 'BestCourseMatch' in processed_df.columns:
            example_cols.extend(['BestCourseMatch', 'MatchScore'])
        
        print(processed_df[example_cols].head(10).to_string())
        
        # Export processed data
        preprocessor.export_processed_data(processed_df)
        
    except FileNotFoundError as e:
        print(f"Error loading data: {e}")
        print("Please make sure your CSV files are in the correct location")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()