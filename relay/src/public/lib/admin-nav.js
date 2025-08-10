/**
 * Admin Navigation Helper
 * Intelligently replaces existing back buttons based on admin authentication
 */

(function() {
    'use strict';

    // Funzione per creare un pulsante Back intelligente
    function createSmartBackButton() {
        const hasAdminToken = localStorage.getItem('shogun-relay-admin-password');
        const backUrl = hasAdminToken ? '/admin' : '/';
        const backText = hasAdminToken ? '🔐 Back to Admin' : '← Back to Control Panel';
        
        return `<a href="${backUrl}" class="text-[#42A5F5] hover:text-[#64B5F6] transition-colors text-lg">${backText}</a>`;
    }

    // Funzione per sostituire solo i pulsanti Back esistenti (non aggiungere nuovi)
    function replaceExistingBackButtons() {
        // Sostituisci i link "Back to Control Panel" e "Back to Dashboard" esistenti
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

        // Sostituisci i pulsanti "Back" generici esistenti
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
            replaceExistingBackButtons();
        });
    } else {
        replaceExistingBackButtons();
    }

    // Esegui anche dopo un breve delay per pagine che caricano dinamicamente
    setTimeout(function() {
        replaceExistingBackButtons();
    }, 1000);

    // Esponi le funzioni globalmente
    window.createSmartBackButton = createSmartBackButton;
    window.replaceExistingBackButtons = replaceExistingBackButtons;

})(); 