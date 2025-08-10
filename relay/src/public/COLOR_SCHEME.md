# Shogun Relay Color Scheme

## Overview
This document defines the color scheme used in the Shogun Relay Control Panel interface. All colors are implemented using Tailwind CSS arbitrary value syntax.

## Primary Colors

### Background Colors
- **Main Background**: `#1A1A1A` - Very dark grey/black (body background)
- **Panel Background**: `#282828` - Dark grey (card backgrounds)
- **Input Background**: `#404040` - Medium grey (input fields)
- **Footer Background**: `#202040` - Dark blue/purple (footer)

### Border Colors
- **Panel Borders**: `#404040` - Medium grey (card borders)
- **Input Borders**: `#606060` - Light grey (input borders when needed)

## Text Colors

### Primary Text
- **Main Text**: `#FFFFFF` - Pure white (headings, main content)
- **Secondary Text**: `#E0E0E0` - Light grey (descriptions, status text)
- **Placeholder Text**: `#A0A0A0` - Medium grey (input placeholders)

### Accent Text
- **Section Headers**: `#FF69B4` - Vibrant pink/magenta (panel titles)
- **Subtitle**: `#8B94FF` - Light blue (subtitle text)

## Icon Colors

### Status Icons
- **Lock Icons**: `#FFA500` - Orange/gold (security indicators)
- **Unlock Icons**: `#4CAF50` - Green (success indicators)

### Feature Icons
- **Lightning/Performance**: `#FFD700` - Gold/yellow
- **Tools/Settings**: `#A0A0A0` - Grey
- **Charts/Analytics**: `#64B5F6` - Light blue
- **Globe/Network**: `#42A5F5` - Blue
- **Upload/Data**: `#42A5F5` - Blue
- **Pin/Important**: `#FF0000` - Red
- **Status/Health**: `#4CAF50` - Green
- **IPCM/Folder**: `#FFEB3B` - Yellow
- **Notes/Documents**: `#F44336` - Red
- **Chat/Communication**: `#A0A0A0` - Grey

## Interactive Elements

### Buttons
- **Primary Button**: `#FF69B4` (background) + `#FFFFFF` (text)
- **Primary Button Hover**: `#FF1493` (background)
- **Secondary Button**: Transparent background + `#E0E0E0` (text)
- **Secondary Button Hover**: `#404040` (background) + `#FFFFFF` (text)

### Links
- **Link Color**: `#42A5F5` - Blue
- **Link Hover**: `#64B5F6` - Light blue

### Focus States
- **Input Focus Ring**: `#FF69B4` with 50% opacity

## Usage Examples

### Tailwind Classes
```html
<!-- Main background -->
<div class="bg-[#1A1A1A]">

<!-- Panel background -->
<div class="bg-[#282828] border-[#404040]">

<!-- Section header -->
<h2 class="text-[#FF69B4]">

<!-- Main text -->
<p class="text-[#FFFFFF]">

<!-- Secondary text -->
<p class="text-[#E0E0E0]">

<!-- Lock icon -->
<span class="text-[#FFA500]">🔒</span>

<!-- Unlock icon -->
<span class="text-[#4CAF50]">🔓</span>

<!-- Primary button -->
<button class="bg-[#FF69B4] hover:bg-[#FF1493] text-[#FFFFFF]">

<!-- Input field -->
<input class="bg-[#404040] text-[#FFFFFF] placeholder-[#A0A0A0] focus:ring-[#FF69B4]">
```

## Color Palette Summary

| Element | Color | Hex Code | Usage |
|---------|-------|----------|-------|
| Main Background | Very Dark Grey | `#1A1A1A` | Body background |
| Panel Background | Dark Grey | `#282828` | Card backgrounds |
| Input Background | Medium Grey | `#404040` | Input fields |
| Footer Background | Dark Blue | `#202040` | Footer area |
| Main Text | White | `#FFFFFF` | Headings, content |
| Secondary Text | Light Grey | `#E0E0E0` | Descriptions |
| Placeholder | Medium Grey | `#A0A0A0` | Input placeholders |
| Section Headers | Pink/Magenta | `#FF69B4` | Panel titles |
| Subtitle | Light Blue | `#8B94FF` | Subtitle text |
| Lock Icons | Orange/Gold | `#FFA500` | Security indicators |
| Unlock Icons | Green | `#4CAF50` | Success indicators |
| Primary Button | Pink | `#FF69B4` | Main actions |
| Primary Button Hover | Dark Pink | `#FF1493` | Button hover |
| Links | Blue | `#42A5F5` | Hyperlinks |
| Links Hover | Light Blue | `#64B5F6` | Link hover |

## Implementation Notes

- All colors use Tailwind's arbitrary value syntax `[#HEXCODE]`
- The color scheme follows a dark theme with high contrast
- Pink/magenta (`#FF69B4`) is used as the primary accent color
- Orange/gold (`#FFA500`) is used for security and warning indicators
- Green (`#4CAF50`) is used for success and positive states
- Blue tones are used for interactive elements and links
- Grey tones provide the neutral base for the dark theme

## Accessibility

- High contrast ratios for text readability
- Consistent color usage for semantic meaning
- Clear visual hierarchy through color differentiation
- Proper focus indicators for keyboard navigation 