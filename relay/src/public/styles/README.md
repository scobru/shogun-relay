# Shogun Relay Responsive Design

This document outlines the responsive design system implemented across the Shogun Relay web applications.

## Standardized Breakpoints

We've standardized the responsive breakpoints across all applications:

- `xs`: 480px (mobile phones)
- `sm`: 640px (large phones, small tablets)
- `md`: 768px (tablets)
- `lg`: 1024px (small laptops)
- `xl`: 1280px (laptops, desktops)
- `2xl`: 1536px (large desktops)

## Shared Responsive CSS

The `responsive.css` file provides standardized responsive components that can be used across all applications. Include it in your HTML files:

```html
<link rel="stylesheet" href="styles/responsive.css">
```

## Available Responsive Classes

### Layout Classes

- `.container-responsive` - Responsive container with appropriate padding
- `.grid-responsive` - Grid layout that adapts from 1 column on mobile to 4 columns on large screens
- `.card-responsive` - Card component with responsive padding
- `.flex-col-to-row` - Flexbox container that switches from column to row layout on larger screens

### Typography Classes

- `.text-responsive-title` - Responsive title text (20px → 24px → 30px)
- `.text-responsive-subtitle` - Responsive subtitle text (18px → 20px)

### Form Elements

- `.input-responsive` - Responsive input field
- `.textarea-responsive` - Responsive textarea with adaptive height
- `.btn-responsive` - Button that spans full width on mobile and auto width on larger screens

### Utilities

- `.vh-fix` - Fixes the viewport height issue on mobile browsers
- `.spacing-responsive` - Responsive bottom margin
- `.table-responsive-container` - Container for tables that enables horizontal scrolling on small screens
- `.message-responsive` - Responsive message/alert container
- `.icon-responsive` - Icons that scale based on screen size

## Mobile Viewport Height Fix

The CSS includes a fix for the mobile viewport height issue. This ensures that elements with `height: 100vh` work correctly on mobile browsers where the address bar can change the viewport height.

## Usage Example

```html
<div class="container-responsive">
  <h1 class="text-responsive-title spacing-responsive">Page Title</h1>
  
  <div class="grid-responsive">
    <div class="card-responsive">
      <h2 class="text-responsive-subtitle">Card Title</h2>
      <p>Card content goes here...</p>
      <div class="flex-col-to-row">
        <input type="text" class="input-responsive" placeholder="Enter text">
        <button class="btn-responsive">Submit</button>
      </div>
    </div>
    
    <!-- More cards... -->
  </div>
  
  <div class="table-responsive-container">
    <table>
      <!-- Table content... -->
    </table>
  </div>
</div>
```

## Best Practices

1. **Mobile-First Approach**: Always design for mobile first, then enhance for larger screens.
2. **Use Standardized Breakpoints**: Stick to the defined breakpoints for consistency.
3. **Test on Real Devices**: Always test your responsive designs on actual devices.
4. **Avoid Fixed Widths**: Use percentage-based or viewport-based widths instead of fixed pixel values.
5. **Consider Touch Targets**: Ensure interactive elements are large enough for touch (minimum 44×44px).
6. **Optimize Images**: Use responsive images with appropriate sizes for different devices.

## Implemented Improvements

The following files have been updated with responsive improvements:

- `charts.html` - Fixed mobile layout, improved stats display, standardized breakpoints
- `chat.html` - Enhanced mobile message display, improved form layout
- `client.html` - Fixed input groups on mobile, improved container padding
- `create.html` - Optimized textarea height, improved button styling on mobile

## Future Improvements

- Implement the shared responsive CSS across all remaining applications
- Add responsive image handling
- Enhance table responsiveness with stacked views on mobile 