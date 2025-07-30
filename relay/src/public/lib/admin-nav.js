/**
 * Admin Navigation Helper
 * Adds "Back to Admin" button to protected pages
 */

(function() {
    'use strict';

    function addAdminBackButton() {
        // Cerca un container per i pulsanti di navigazione
        const navContainers = document.querySelectorAll('.flex.gap-3, .card-actions, .btn-group, .navbar, header');
        
        for (const container of navContainers) {
            // Controlla se già esiste un pulsante "Back to Admin"
            if (container.querySelector('a[href="/admin"]')) {
                continue;
            }

            // Crea il pulsante "Back to Admin"
            const adminButton = document.createElement('a');
            adminButton.href = '/admin';
            adminButton.className = 'btn bg-[#FF69B4] hover:bg-[#FF1493] border-0 text-[#FFFFFF] rounded-xl px-4 py-2 font-medium';
            adminButton.innerHTML = '🔐 Back to Admin';
            adminButton.style.marginRight = '8px';
            
            // Inserisci il pulsante all'inizio del container
            container.insertBefore(adminButton, container.firstChild);
            
            console.log('✅ Added "Back to Admin" button');
            break; // Aggiungi solo al primo container trovato
        }
    }

    function addAdminBackButtonToHeader() {
        // Cerca nell'header o nella navbar
        const header = document.querySelector('header, .navbar, .header');
        if (header) {
            const navContainer = header.querySelector('.flex, .nav, .navbar-nav');
            if (navContainer && !navContainer.querySelector('a[href="/admin"]')) {
                const adminButton = document.createElement('a');
                adminButton.href = '/admin';
                adminButton.className = 'btn bg-[#FF69B4] hover:bg-[#FF1493] border-0 text-[#FFFFFF] rounded-xl px-4 py-2 font-medium';
                adminButton.innerHTML = '🔐 Admin';
                adminButton.style.marginLeft = 'auto';
                
                navContainer.appendChild(adminButton);
                console.log('✅ Added "Back to Admin" button to header');
            }
        }
    }

    // Esegui quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addAdminBackButton();
            addAdminBackButtonToHeader();
        });
    } else {
        addAdminBackButton();
        addAdminBackButtonToHeader();
    }

    // Esegui anche dopo un breve delay per pagine che caricano dinamicamente
    setTimeout(function() {
        addAdminBackButton();
        addAdminBackButtonToHeader();
    }, 1000);

})(); 