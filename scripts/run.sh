#!/bin/bash

# UW-Madison Data Extractors Runner Script
# Usage: ./scripts/run.sh [extractor_name]

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if .env file exists
check_env() {
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            print_info "Please edit .env file with your configuration before running extractors"
            exit 1
        else
            print_error ".env.example not found. Please create .env file manually"
            exit 1
        fi
    fi
}

# Function to check dependencies
check_dependencies() {
    print_info "Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if [ ! -d "node_modules" ]; then
        print_info "Installing Node.js dependencies..."
        npm install
    fi
    
    print_success "Dependencies checked"
}

# Function to run specific extractor
run_extractor() {
    local extractor=$1
    
    case $extractor in
        "madgrades")
            print_info "Running MadGrades extractor..."
            node src/extractors/madgrades_extractor.js
            ;;
        "courses")
            print_info "Running Course Search & Enroll extractor..."
            node src/extractors/course_search_and_enroll_extractor.js
            ;;
        "rmp")
            print_info "Running Rate My Professor extractor..."
            node src/extractors/rmp-extractor.js
            ;;
        "preprocess-rmp")
            print_info "Running RMP preprocessor..."
            if command -v python3 &> /dev/null; then
                python3 src/preprocessors/rmp_preprocessor.py
            elif command -v python &> /dev/null; then
                python src/preprocessors/rmp_preprocessor.py
            else
                print_error "Python is not installed"
                exit 1
            fi
            ;;
        "all")
            print_info "Running all extractors..."
            run_extractor "madgrades"
            run_extractor "courses"
            run_extractor "rmp"
            run_extractor "preprocess-rmp"
            ;;
        *)
            print_error "Unknown extractor: $extractor"
            print_info "Available extractors: madgrades, courses, rmp, preprocess-rmp, all"
            exit 1
            ;;
    esac
}

# Function to show usage
show_usage() {
    echo "UW-Madison Data Extractors"
    echo ""
    echo "Usage: $0 [extractor_name]"
    echo ""
    echo "Available extractors:"
    echo "  madgrades       - Extract grade data from MadGrades API"
    echo "  courses         - Extract course and section data"
    echo "  rmp             - Extract Rate My Professor data"
    echo "  preprocess-rmp  - Clean and preprocess RMP data"
    echo "  all             - Run all extractors in sequence"
    echo ""
    echo "Examples:"
    echo "  $0 madgrades"
    echo "  $0 all"
    echo ""
}

# Main script logic
main() {
    print_info "UW-Madison Data Extractors"
    print_info "=========================="
    
    # Check if argument provided
    if [ $# -eq 0 ]; then
        show_usage
        exit 1
    fi
    
    # Check prerequisites
    check_env
    check_dependencies
    
    # Run the specified extractor
    run_extractor $1
    
    print_success "Extraction completed!"
}

# Run main function with all arguments
main "$@"
