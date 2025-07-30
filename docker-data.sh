#!/bin/bash

# Shogun Relay Docker Data Management Script
# This script helps manage data persistence, backups, and cleanup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[HEADER]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  backup [filename]     Create backup of all data volumes"
    echo "  restore [filename]    Restore data from backup file"
    echo "  list-backups          List available backup files"
    echo "  cleanup               Remove old backup files (older than 7 days)"
    echo "  status                Show data volume status"
    echo "  reset                 WARNING: Remove all data volumes (complete reset)"
    echo "  help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 backup                    # Create backup with timestamp"
    echo "  $0 backup my-backup.tar.gz   # Create backup with custom name"
    echo "  $0 restore my-backup.tar.gz  # Restore from backup"
    echo "  $0 status                    # Show volume status"
    echo "  $0 reset                     # Complete data reset"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Start Docker Desktop and try again."
        exit 1
    fi
}

# Function to check if docker-compose is available
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null; then
        print_error "docker-compose is not installed or not in PATH"
        exit 1
    fi
}

# Function to create backup
create_backup() {
    local backup_file=${1:-"shogun-relay-backup-$(date +%Y%m%d-%H%M%S).tar.gz"}
    
    print_header "Creating backup: $backup_file"
    
    # Stop services to ensure data consistency
    print_status "Stopping services for consistent backup..."
    docker-compose down
    
    # Create backup
    print_status "Creating backup archive..."
    docker run --rm \
        -v shogun-relay_gun-data:/gun-data \
        -v shogun-relay_ipfs-data:/ipfs-data \
        -v $(pwd):/backup \
        alpine tar czf "/backup/$backup_file" \
        -C /gun-data . \
        -C /ipfs-data .
    
    # Restart services
    print_status "Restarting services..."
    docker-compose up -d
    
    print_status "Backup completed: $backup_file"
    print_status "Backup size: $(du -h "$backup_file" | cut -f1)"
}

# Function to restore backup
restore_backup() {
    local backup_file=$1
    
    if [ -z "$backup_file" ]; then
        print_error "Backup filename is required"
        echo "Usage: $0 restore <backup-file>"
        exit 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        print_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    print_warning "This will overwrite all existing data!"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Restore cancelled"
        exit 0
    fi
    
    print_header "Restoring from backup: $backup_file"
    
    # Stop services
    print_status "Stopping services..."
    docker-compose down
    
    # Remove existing volumes
    print_status "Removing existing volumes..."
    docker volume rm shogun-relay_gun-data shogun-relay_ipfs-data 2>/dev/null || true
    
    # Create new volumes
    print_status "Creating new volumes..."
    docker volume create shogun-relay_gun-data
    docker volume create shogun-relay_ipfs-data
    
    # Restore data
    print_status "Restoring data..."
    docker run --rm \
        -v shogun-relay_gun-data:/gun-data \
        -v shogun-relay_ipfs-data:/ipfs-data \
        -v $(pwd):/backup \
        alpine sh -c "cd /gun-data && tar xzf /backup/$backup_file && cd /ipfs-data && tar xzf /backup/$backup_file"
    
    # Restart services
    print_status "Restarting services..."
    docker-compose up -d
    
    print_status "Restore completed successfully"
}

# Function to list backups
list_backups() {
    print_header "Available backup files:"
    
    if ls shogun-relay-backup-*.tar.gz 2>/dev/null; then
        echo ""
        print_status "Backup files found:"
        ls -lh shogun-relay-backup-*.tar.gz
    else
        print_warning "No backup files found"
    fi
}

# Function to cleanup old backups
cleanup_backups() {
    print_header "Cleaning up old backup files (older than 7 days)..."
    
    local deleted_count=0
    for file in shogun-relay-backup-*.tar.gz; do
        if [ -f "$file" ]; then
            if [ $(find "$file" -mtime +7) ]; then
                print_status "Removing old backup: $file"
                rm "$file"
                ((deleted_count++))
            fi
        fi
    done
    
    if [ $deleted_count -eq 0 ]; then
        print_status "No old backup files to remove"
    else
        print_status "Removed $deleted_count old backup files"
    fi
}

# Function to show status
show_status() {
    print_header "Data Volume Status"
    
    echo ""
    print_status "Docker Volumes:"
    docker volume ls | grep shogun-relay || print_warning "No shogun-relay volumes found"
    
    echo ""
    print_status "Volume Details:"
    for volume in shogun-relay_gun-data shogun-relay_ipfs-data; do
        if docker volume inspect "$volume" >/dev/null 2>&1; then
            local size=$(docker run --rm -v "$volume":/data alpine du -sh /data 2>/dev/null | cut -f1 || echo "unknown")
            print_status "$volume: $size"
        else
            print_warning "$volume: not found"
        fi
    done
    
    echo ""
    print_status "Backup Files:"
    if ls shogun-relay-backup-*.tar.gz 2>/dev/null; then
        ls -lh shogun-relay-backup-*.tar.gz
    else
        print_warning "No backup files found"
    fi
}

# Function to reset all data
reset_data() {
    print_warning "WARNING: This will permanently delete ALL data!"
    print_warning "This action cannot be undone!"
    read -p "Are you absolutely sure? Type 'DELETE ALL DATA' to confirm: " -r
    echo
    
    if [ "$REPLY" != "DELETE ALL DATA" ]; then
        print_status "Reset cancelled"
        exit 0
    fi
    
    print_header "Performing complete data reset"
    
    # Stop services
    print_status "Stopping services..."
    docker-compose down
    
    # Remove volumes
    print_status "Removing all data volumes..."
    docker volume rm shogun-relay_gun-data shogun-relay_ipfs-data 2>/dev/null || true
    
    # Remove backup files
    print_status "Removing backup files..."
    rm -f shogun-relay-backup-*.tar.gz
    
    print_status "Complete reset finished"
    print_status "Run './docker-start.sh' to start fresh"
}

# Main script logic
main() {
    check_docker
    check_docker_compose
    
    case "${1:-help}" in
        backup)
            create_backup "$2"
            ;;
        restore)
            restore_backup "$2"
            ;;
        list-backups)
            list_backups
            ;;
        cleanup)
            cleanup_backups
            ;;
        status)
            show_status
            ;;
        reset)
            reset_data
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            print_error "Unknown command: $1"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@" 