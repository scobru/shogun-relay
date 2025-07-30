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

    // Funzione per creare un pulsante Back intelligente
    function createSmartBackButton() {
        const hasAdminToken = localStorage.getItem('shogun-relay-admin-password');
        const backUrl = hasAdminToken ? '/admin' : '/';
        const backText = hasAdminToken ? '🔐 Back to Admin' : '← Back to Control Panel';
        
        return `<a href="${backUrl}" class="text-[#42A5F5] hover:text-[#64B5F6] transition-colors text-lg">${backText}</a>`;
    }

    // Funzione per sostituire tutti i pulsanti Back esistenti
    function replaceBackButtons() {
        // Sostituisci i link "Back to Control Panel" e "Back to Dashboard"
        const backLinks = document.querySelectorAll('a[href="/"]');
        backLinks.forEach(link => {
            if (link.textContent.includes('Back to Control Panel') || 
                link.textContent.includes('Back to Dashboard') ||
                link.textContent.includes('← Back')) {
                
                const hasAdminToken = localStorage.getItem('shogun-relay-admin-password');
                const backUrl = hasAdminToken ? '/admin' : '/';
                const backText = hasAdminToken ? '🔐 Back to Admin' : '← Back to Control Panel';
                
                link.href = backUrl;
                link.textContent = backText;
                link.className = 'text-[#42A5F5] hover:text-[#64B5F6] transition-colors text-lg';
            }
        });

        // Sostituisci i pulsanti "Back" generici
        const backButtons = document.querySelectorAll('a.btn[href="/"]');
        backButtons.forEach(button => {
            if (button.textContent.includes('Back')) {
                const hasAdminToken = localStorage.getItem('shogun-relay-admin-password');
                const backUrl = hasAdminToken ? '/admin' : '/';
                const backText = hasAdminToken ? '🔐 Back to Admin' : '← Back to Control Panel';
                
                button.href = backUrl;
                button.textContent = backText;
            }
        });
    }

    // Esegui quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addAdminBackButton();
            addAdminBackButtonToHeader();
            replaceBackButtons();
        });
    } else {
        addAdminBackButton();
        addAdminBackButtonToHeader();
        replaceBackButtons();
    }

    // Esegui anche dopo un breve delay per pagine che caricano dinamicamente
    setTimeout(function() {
        addAdminBackButton();
        addAdminBackButtonToHeader();
        replaceBackButtons();
    }, 1000);

    // Esponi le funzioni globalmente
    window.createSmartBackButton = createSmartBackButton;
    window.replaceBackButtons = replaceBackButtons;

})(); 