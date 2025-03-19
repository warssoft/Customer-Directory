import { db, auth, auditCollection } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    writeBatch,
    setDoc,
    runTransaction,
    query,
    where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

let customers = [];
let currentEditDocId = null;
let sortEndDateAscending = true;

// **FIX**: Centralized event delegation for all actions
document.addEventListener('click', async (e) => {
    if (e.target.closest('.action-btn-icon')) {
        const button = e.target.closest('.action-btn-icon');
        const action = button.classList.contains('whatsapp') ? 'whatsapp' 
            : button.classList.contains('edit') ? 'edit' 
            : button.classList.contains('delete') ? 'delete' 
            : null;
        
        if (!action) return;

        const row = button.closest('tr');
        const customerId = row.querySelector('[data-id]')?.dataset.id;
        const customerPhone = row.querySelector('td:nth-child(2)')?.textContent.trim();

        switch(action) {
            case 'whatsapp':
                handleWhatsAppClick(row, customerPhone);
                break;
            case 'edit':
                editCustomer(customerId);
                break;
            case 'delete':
                deleteCustomer(customerId);
                break;
        }
    }
});

// ================= AUTHENTICATION =================
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        await logAction('login_success', { email });
        window.location.href = 'dashboard.html';
    } catch (error) {
        console.error('[ERREUR] Code:', error.code, 'Message:', error.message);
        await logAction('login_failure', { 
            email,
            errorCode: error.code,
            errorMessage: error.message
        });
        let errorMessage = '';
        switch(error.code) {
            case 'auth/invalid-email':
                errorMessage = 'Email invalide';
                break;
            case 'auth/user-not-found':
                errorMessage = 'Utilisateur inexistant';
                break;
            case 'auth/wrong-password':
                errorMessage = 'Mot de passe incorrect';
                break;
            default:
                errorMessage = `Erreur technique: ${error.message}`;
        }
        showToast(errorMessage, 'error');
    }
});

// ================= AUTH STATE MANAGEMENT =================
onAuthStateChanged(auth, (user) => {
    if (!user && !window.location.pathname.includes('home.html')) {
        window.location.href = 'home.html';
    }
});

// ================= AUTHORIZATION CHECK =================
async function isAdmin() {
    if (!auth.currentUser) return false;
    try {
        const token = await auth.currentUser.getIdTokenResult();
        return token.claims.admin || false;
    } catch (error) {
        console.error('[ERREUR] Vérification admin:', error);
        return false;
    }
}

// ================= AUDIT LOGGING =================
async function logAction(action, details) {
    try {
        const ip = await fetch('https://api.ipify.org?format=json')
            .then(response => response.json())
            .then(data => data.ip)
            .catch(() => 'IP non disponible');
        await addDoc(auditCollection, {
            userId: auth.currentUser?.uid || 'anon',
            action,
            details: JSON.stringify(details),
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            ip
        });
    } catch (error) {
        console.error('[ERREUR] Audit log:', error);
    }
}

// ================= SUBSCRIBER MANAGEMENT =================
async function addSubscriber(data) {
    try {
        const existingSubs = await getDocs(
            query(collection(db, "Subscribers"), where("subNumber", "==", data.subNumber))
        );
        if (!existingSubs.empty) {
            throw new Error("Abonné existant");
        }
        const docRef = await addDoc(collection(db, "Subscribers"), data);
        console.log("Subscriber added with ID: ", docRef.id);
        return docRef.id;
    } catch (error) {
        console.error("[ERREUR] Ajout abonné:", error);
        throw error;
    }
}

// ================= CUSTOMER MANAGEMENT =================
document.getElementById('customerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('phone');
    const subNumberInput = document.getElementById('subNumber');
    const phoneRegex = /^(?:\+212|0)[5-7]\d{8}$/;
    const subNumberRegex = /^[A-Z0-9]{10}$/;
    
    if (!phoneRegex.test(phoneInput.value)) {
        showToast('Format téléphone invalide', 'error');
        return;
    }
    if (!subNumberRegex.test(subNumberInput.value)) {
        showToast('Numéro d\'abonnement invalide', 'error');
        return;
    }
    
    const customerData = {
        name: document.getElementById('fullName').value.trim(),
        phone: phoneInput.value.trim(),
        subNumber: subNumberInput.value.trim().toUpperCase(),
        subType: document.getElementById('subType').value.trim(),
        startDate: document.getElementById('startDate').value,
        validity: parseInt(document.getElementById('validity').value),
        endDate: calculateEndDate(
            document.getElementById('startDate').value,
            document.getElementById('validity').value
        ),
        status: getStatus(
            document.getElementById('startDate').value,
            document.getElementById('validity').value
        ),
        createdBy: auth.currentUser.uid,
        lastModified: new Date().toISOString()
    };

    try {
        if (currentEditDocId) {
            await runTransaction(db, async (transaction) => {
                const customerRef = doc(db, "customers", currentEditDocId);
                transaction.update(customerRef, customerData);
                const subscriberRef = doc(db, "Subscribers", currentEditDocId);
                transaction.update(subscriberRef, customerData);
            });
            await logAction('customer_and_subscriber_updated', { docId: currentEditDocId });
        } else {
            await runTransaction(db, async (transaction) => {
                const customerRef = doc(collection(db, "customers"));
                transaction.set(customerRef, customerData);
                const subscriberRef = doc(collection(db, "Subscribers"));
                transaction.set(subscriberRef, customerData);
            });
            await logAction('customer_and_subscriber_created', { subNumber: customerData.subNumber });
        }
        showToast(currentEditDocId ? "Client mis à jour" : "Client créé", "success");
        currentEditDocId = null;
        window.location.href = 'customer-list.html';
    } catch (error) {
        console.error('[ERREUR] Sauvegarde client:', error);
        showToast(`Erreur: ${error.message}`, 'error');
    }
});

// ================= REAL-TIME SYNC =================
onSnapshot(collection(db, "customers"), (snapshot) => {
    customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    customers.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    renderCustomerList();
    renderHomeCustomers();
});

// ================= DATA EXPORT/IMPORT =================
async function exportData() {
    try {
        const querySnapshot = await getDocs(collection(db, "customers"));
        const data = querySnapshot.docs.map(doc => doc.data());
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        saveAs(blob, `customers_${new Date().toISOString()}.json`);
        await logAction('data_export', { recordCount: data.length });
    } catch (error) {
        console.error('[ERREUR] Export:', error);
        showToast(`Export échoué: ${error.message}`, 'error');
    }
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const imported = JSON.parse(await file.text());
        const batch = writeBatch(db);
        const existingSubs = new Set(customers.map(c => c.subNumber));
        imported.forEach(customer => {
            if (!existingSubs.has(customer.subNumber)) {
                const docRef = doc(collection(db, "customers"));
                batch.set(docRef, {
                    ...customer,
                    importedAt: new Date().toISOString(),
                    importedBy: auth.currentUser.uid
                });
            }
        });
        await batch.commit();
        await logAction('data_import', { recordCount: imported.length });
        showToast('Import réussi', 'success');
    } catch (error) {
        console.error('[ERREUR] Import:', error);
        showToast(`Import échoué: ${error.message}`, 'error');
    }
}

// ================= WHATSAPP MESSAGING =================
async function generateWhatsAppMessage(c) {
    try {
        const [ratesDoc, offersDoc] = await Promise.all([
            getDoc(doc(db, "settings", "rates")),
            getDoc(doc(db, "settings", "offers"))
        ]);
        
        const endDate = c.endDate ? new Date(c.endDate) : new Date();
        const formattedDate = endDate.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        let message = `Bonjour cher client,\n`;
        message += `Votre numéro d'abonnement S/C Série : ${c.subNumber}\n`;

        if (c.status === 'Active') {
            message += `✓ Nouveau statut: ${formattedDate}.\n`;
            message += `Félicitations, votre abonnement a été renouvelé.\n`;
        } else {
            message += `⚠ Expire Le ${formattedDate}.\n`;
            message += `Veuillez renouveler votre abonnement.\n`;
            
            const rates = ratesDoc.exists() ? ratesDoc.data().subscriptionRates : 'Contactez-nous';
            const offers = offersDoc.exists() ? offersDoc.data().specialOffers : 'Aucune offre';
            
            message += `Tarifs de renouvellement:\n${rates}\n`;
            message += `Offres spéciales:\n${offers}\n`;
        }

        message += `Merci pour votre fidélité.\n`;
        message += `"beIN SPORTS Ouarzazate - 📞 05 24 88 67 67"\n`;
        message += `"Electro El Habib"`;
        
        return encodeURIComponent(message);
    } catch (error) {
        console.error('[ERREUR] Génération message:', error);
        return '';
    }
}

// ================= UI RENDERING FUNCTIONS =================
function renderCustomerList() {
    const tbody = document.getElementById('customerListBody');
    if (!tbody) return;
    
    tbody.innerHTML = customers.map(c => {
        const formattedPhone = formatPhoneNumber(c.phone);
        return `
            <tr class="status-${c.status.toLowerCase()}" data-id="${c.id}">
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td>${c.subNumber}</td>
                <td>${c.subType}</td>
                <td>${c.startDate}</td>
                <td>${c.endDate}</td>
                <td>${c.status}</td>
                <td>
                    <div class="action-group">
                        ${isAdmin() ? `
                        <button class="action-btn-icon edit">✎<span>Edit</span></button>
                        <button class="action-btn-icon delete">🗑<span>Delete</span></button>
                        ` : ''}
                        <button class="action-btn-icon whatsapp" data-phone="${formattedPhone}" data-customer='${JSON.stringify(c)}'>
                            💬<span>WhatsApp</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderHomeCustomers() {
    const tbody = document.getElementById('homeResultsBody');
    if (!tbody) return;
    
    tbody.innerHTML = customers.map(c => {
        const formattedPhone = formatPhoneNumber(c.phone);
        return `
            <tr class="status-${c.status.toLowerCase()}" data-id="${c.id}">
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td>${c.subNumber}</td>
                <td>${c.subType}</td>
                <td>${c.startDate}</td>
                <td>${c.endDate}</td>
                <td>${c.status}</td>
                <td>
                    <div class="action-group">
                        ${isAdmin() ? `
                        <button class="action-btn-icon edit">✎<span>Edit</span></button>
                        <button class="action-btn-icon delete">🗑<span>Delete</span></button>
                        ` : ''}
                        <button class="action-btn-icon whatsapp" data-phone="${formattedPhone}" data-customer='${JSON.stringify(c)}'>
                            💬<span>WhatsApp</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    renderStatusCounts();
}

// ================= HELPER FUNCTIONS =================
function toggleSortEndDate() {
    sortEndDateAscending = !sortEndDateAscending;
    customers.sort((a, b) => 
        sortEndDateAscending 
            ? new Date(a.endDate) - new Date(b.endDate) 
            : new Date(b.endDate) - new Date(a.endDate)
    );
    renderCustomerList();
    renderHomeCustomers();
}

function refreshPage() {
    window.location.reload();
}

function renderStatusCounts() {
    const expiredCount = customers.filter(c => c.status === 'Expired').length;
    const criticalCount = customers.filter(c => c.status === 'Critical').length;
    const activeCount = customers.filter(c => c.status === 'Active').length;
    
    document.getElementById('expiredCount')?.textContent = expiredCount;
    document.getElementById('criticalCount')?.textContent = criticalCount;
    document.getElementById('activeCount')?.textContent = activeCount;
    
    const importantCustomer = customers.find(c => c.status === 'Critical');
    const importantSub = document.getElementById('importantSub');
    if (importantSub) {
        importantSub.textContent = importantCustomer ? importantCustomer.subNumber : '-';
    }
}

function formatPhoneNumber(phone) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '212' + cleanPhone.slice(1);
        }
        return cleanPhone.replace(/(\d{3})(\d{3})(\d{3})(\d{3})/, '$1$2$3$4');
    } catch (error) {
        console.error('[ERREUR] Formatage du numéro:', error);
        return phone;
    }
}

function calculateEndDate(startDate, validity) {
    const date = new Date(startDate);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid start date');
    }
    date.setMonth(date.getMonth() + parseInt(validity));
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

function getStatus(startDate, validity) {
    try {
        const endDate = calculateEndDate(startDate, validity);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((new Date(endDate) - now) / 86400000);
        return diffDays <= 0 ? 'Expired' : diffDays <= 7 ? 'Critical' : 'Active';
    } catch (error) {
        console.error('[ERREUR] Calcul du statut:', error);
        return 'Unknown';
    }
}

// ================= USER MANAGEMENT =================
async function deleteCustomer(docId) {
    if (!(await isAdmin())) {
        showToast('Accès administrateur requis', 'error');
        return;
    }
    if (confirm('Supprimer définitivement ce client ?')) {
        try {
            await runTransaction(db, async (transaction) => {
                transaction.delete(doc(db, "customers", docId));
                transaction.delete(doc(db, "Subscribers", docId));
            });
            await logAction('customer_deleted', { docId });
            showToast('Client supprimé', 'success');
        } catch (error) {
            console.error('[ERREUR] Suppression:', error);
            showToast(`Échec suppression: ${error.message}`, 'error');
        }
    }
}

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('edit')) {
            currentEditDocId = urlParams.get('edit');
            await loadRateSettings();
            await loadCustomers();
            const customer = customers.find(c => c.id === currentEditDocId);
            if (customer) {
                populateFormFields(customer);
            }
        }
    } catch (error) {
        console.error('[ERREUR] Initialisation:', error);
        showToast(`Erreur d'initialisation: ${error.message}`, 'error');
    }
});

// ================= UTILITY FUNCTIONS =================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

async function loadRateSettings() {
    try {
        const [ratesDoc, offersDoc] = await Promise.all([
            getDoc(doc(db, "settings", "rates")),
            getDoc(doc(db, "settings", "offers"))
        ]);
        document.getElementById('classicRates')?.setAttribute('value', 
            ratesDoc.exists() ? ratesDoc.data().subscriptionRates : ''
        );
        document.getElementById('specialOffers')?.setAttribute('value', 
            offersDoc.exists() ? offersDoc.data().specialOffers : ''
        );
    } catch (error) {
        console.error('[ERREUR] Chargement paramètres:', error);
        showToast(`Erreur chargement paramètres: ${error.message}`, 'error');
    }
}

async function loadCustomers() {
    try {
        const querySnapshot = await getDocs(collection(db, "customers"));
        customers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        customers.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
        return customers;
    } catch (error) {
        console.error('[ERREUR] Chargement clients:', error);
        showToast(`Erreur chargement clients: ${error.message}`, 'error');
        return [];
    }
}

function searchList() {
    const searchTerm = document.getElementById('listSearch').value.toLowerCase();
    const filtered = customers.filter(customer =>
        Object.values(customer).some(value =>
            value.toString().toLowerCase().includes(searchTerm)
        )
    );
    const tbody = document.getElementById('customerListBody') || 
                 document.getElementById('homeResultsBody');
    if (tbody) {
        tbody.innerHTML = filtered.map(c => `
            <tr class="status-${c.status.toLowerCase()}" data-id="${c.id}">
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td>${c.subNumber}</td>
                <td>${c.subType}</td>
                <td>${c.startDate}</td>
                <td>${c.endDate}</td>
                <td>${c.status}</td>
                <td>
                    <div class="action-group">
                        ${isAdmin() ? `
                        <button class="action-btn-icon edit">✎<span>Edit</span></button>
                        <button class="action-btn-icon delete">🗑<span>Delete</span></button>
                        ` : ''}
                        <button class="action-btn-icon whatsapp" data-phone="${formatPhoneNumber(c.phone)}" data-customer='${JSON.stringify(c)}'>
                            💬<span>WhatsApp</span>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }
}

function editCustomer(docId) {
    window.location.href = `add-customer.html?edit=${docId}`;
}

// ================= LOGOUT FIX =================
window.logout = async function() {
    if (confirm('Confirmez la déconnexion ?')) {
        try {
            await signOut(auth);
            await logAction('logout', {});
            window.location.href = 'home.html';
        } catch (error) {
            console.error('[ERREUR] Déconnexion:', error);
            showToast('Échec de la déconnexion', 'error');
        }
    }
};

// **FIX**: WhatsApp button handler
function handleWhatsAppClick(row, phone) {
    const customerData = customers.find(c => c.phone === phone);
    if (!customerData) {
        showToast('Client non trouvé', 'error');
        return;
    }
    generateWhatsAppMessage(customerData)
        .then(encodedMessage => {
            const formattedPhone = formatPhoneNumber(phone);
            window.open(`https://wa.me/${formattedPhone}?text=${encodedMessage}`);
        });
}
