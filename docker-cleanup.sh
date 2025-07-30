#!/bin/bash

# Shogun Relay Docker Cleanup Script
# This script cleans up Docker cache and unused resources without restarting services

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
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --all              Full cleanup (containers, images, networks, volumes, cache)"
    echo "  --cache-only        Clean only build cache and unused images"
    echo "  --containers        Clean only stopped containers"
    echo "  --images            Clean only unused images"
    echo "  --networks          Clean only unused networks"
    echo "  --volumes           Clean only unused volumes (WARNING: may delete data)"
    echo "  --build-cache       Clean only Docker build cache"
    echo "  --dry-run           Show what would be cleaned without actually doing it"
    echo "  --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --cache-only     # Safe cleanup (recommended)"
    echo "  $0 --all            # Full cleanup (use with caution)"
    echo "  $0 --dry-run        # See what would be cleaned"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Start Docker Desktop and try again."
        exit 1
    fi
}

# Function to get Docker disk usage before cleanup
get_docker_usage() {
    print_header "Docker Disk Usage Before Cleanup:"
    docker system df
    echo ""
}

# Function to clean containers
clean_containers() {
    print_status "Cleaning stopped containers..."
    local stopped_containers=$(docker container ls -a --filter "status=exited" --filter "status=created" -q)
    
    if [ -z "$stopped_containers" ]; then
        print_status "No stopped containers found"
    else
        if [ "$DRY_RUN" = true ]; then
            print_warning "Would remove $(echo "$stopped_containers" | wc -l) stopped containers"
            echo "$stopped_containers" | xargs -r docker container ls -a --filter "id="
        else
            docker container prune -f
            print_status "Stopped containers cleaned"
        fi
    fi
}

# Function to clean images
clean_images() {
    print_status "Cleaning unused images..."
    local unused_images=$(docker images -f "dangling=true" -q)
    
    if [ -z "$unused_images" ]; then
        print_status "No unused images found"
    else
        if [ "$DRY_RUN" = true ]; then
            print_warning "Would remove $(echo "$unused_images" | wc -l) unused images"
            echo "$unused_images" | xargs -r docker images --filter "dangling=true"
        else
            docker image prune -f
            print_status "Unused images cleaned"
        fi
    fi
}

# Function to clean networks
clean_networks() {
    print_status "Cleaning unused networks..."
    local unused_networks=$(docker network ls --filter "type=custom" -q)
    
    if [ -z "$unused_networks" ]; then
        print_status "No unused networks found"
    else
        if [ "$DRY_RUN" = true ]; then
            print_warning "Would remove $(echo "$unused_networks" | wc -l) unused networks"
            echo "$unused_networks" | xargs -r docker network ls --filter "type=custom"
        else
            docker network prune -f
            print_status "Unused networks cleaned"
        fi
    fi
}

# Function to clean volumes
clean_volumes() {
    print_warning "Cleaning unused volumes (this may delete data)..."
    local unused_volumes=$(docker volume ls -q)
    
    if [ -z "$unused_volumes" ]; then
        print_status "No unused volumes found"
    else
        if [ "$DRY_RUN" = true ]; then
            print_warning "Would remove $(echo "$unused_volumes" | wc -l) volumes"
            echo "$unused_volumes" | xargs -r docker volume ls
        else
            read -p "Are you sure you want to remove unused volumes? This may delete data! (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                docker volume prune -f
                print_status "Unused volumes cleaned"
            else
                print_status "Volume cleanup skipped"
            fi
        fi
    fi
}

# Function to clean build cache
clean_build_cache() {
    print_status "Cleaning Docker build cache..."
    if [ "$DRY_RUN" = true ]; then
        print_warning "Would clean build cache"
        docker builder du
    else
        docker builder prune -f
        print_status "Build cache cleaned"
    fi
}

# Function to clean everything
clean_all() {
    print_header "Performing full Docker cleanup..."
    
    if [ "$DRY_RUN" = true ]; then
        print_warning "DRY RUN MODE - No actual cleanup will be performed"
        echo ""
    fi
    
    clean_containers
    clean_images
    clean_networks
    clean_volumes
    clean_build_cache
    
    if [ "$DRY_RUN" = false ]; then
        print_status "Running final system cleanup..."
        docker system prune -f
    fi
}

# Function to clean cache only (safe)
clean_cache_only() {
    print_header "Performing safe cache cleanup..."
    
    if [ "$DRY_RUN" = true ]; then
        print_warning "DRY RUN MODE - No actual cleanup will be performed"
        echo ""
    fi
    
    clean_containers
    clean_images
    clean_build_cache
    
    if [ "$DRY_RUN" = false ]; then
        print_status "Running safe system cleanup..."
        docker system prune -f
    fi
}

# Function to get Docker disk usage after cleanup
get_docker_usage_after() {
    print_header "Docker Disk Usage After Cleanup:"
    docker system df
    echo ""
}

# Function to show space saved
show_space_saved() {
    if [ "$DRY_RUN" = false ]; then
        print_header "Cleanup Summary:"
        print_status "Docker cache and unused resources have been cleaned"
        print_status "Check the disk usage above to see space saved"
    fi
}

# Main script logic
main() {
    # Parse command line arguments
    DRY_RUN=false
    CLEAN_ALL=false
    CLEAN_CACHE_ONLY=false
    CLEAN_CONTAINERS=false
    CLEAN_IMAGES=false
    CLEAN_NETWORKS=false
    CLEAN_VOLUMES=false
    CLEAN_BUILD_CACHE=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --all)
                CLEAN_ALL=true
                shift
                ;;
            --cache-only)
                CLEAN_CACHE_ONLY=true
                shift
                ;;
            --containers)
                CLEAN_CONTAINERS=true
                shift
                ;;
            --images)
                CLEAN_IMAGES=true
                shift
                ;;
            --networks)
                CLEAN_NETWORKS=true
                shift
                ;;
            --volumes)
                CLEAN_VOLUMES=true
                shift
                ;;
            --build-cache)
                CLEAN_BUILD_CACHE=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # If no specific option is provided, default to cache-only
    if [ "$CLEAN_ALL" = false ] && [ "$CLEAN_CACHE_ONLY" = false ] && [ "$CLEAN_CONTAINERS" = false ] && [ "$CLEAN_IMAGES" = false ] && [ "$CLEAN_NETWORKS" = false ] && [ "$CLEAN_VOLUMES" = false ] && [ "$CLEAN_BUILD_CACHE" = false ]; then
        CLEAN_CACHE_ONLY=true
    fi
    
    # Check Docker
    check_docker
    
    # Show usage before cleanup
    get_docker_usage
    
    # Perform cleanup based on options
    if [ "$CLEAN_ALL" = true ]; then
        clean_all
    elif [ "$CLEAN_CACHE_ONLY" = true ]; then
        clean_cache_only
    else
        if [ "$CLEAN_CONTAINERS" = true ]; then
            clean_containers
        fi
        if [ "$CLEAN_IMAGES" = true ]; then
            clean_images
        fi
        if [ "$CLEAN_NETWORKS" = true ]; then
            clean_networks
        fi
        if [ "$CLEAN_VOLUMES" = true ]; then
            clean_volumes
        fi
        if [ "$CLEAN_BUILD_CACHE" = true ]; then
            clean_build_cache
        fi
    fi
    
    # Show usage after cleanup
    get_docker_usage_after
    
    # Show summary
    show_space_saved
    
    print_status "Docker cleanup completed successfully!"
}

# Run main function with all arguments
main "$@" 