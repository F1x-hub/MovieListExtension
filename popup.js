class PopupManager {
    constructor() {
        this.elements = this.initializeElements();
        this.records = [];
        this.editingRecordId = null;
        this.setupEventListeners();
        this.setupAuthStateListener();
        this.initializeUI();
    }

    initializeElements() {
        return {
            authSection: document.getElementById('authSection'),
            mainContent: document.getElementById('mainContent'),
            authStatus: document.getElementById('authStatus'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            loginBtn: document.getElementById('loginBtn'),
            logoutBtn: document.getElementById('logoutBtn'),
            loginForm: document.getElementById('loginForm'),
            registerForm: document.getElementById('registerForm'),
            loginEmail: document.getElementById('loginEmail'),
            loginPassword: document.getElementById('loginPassword'),
            registerEmail: document.getElementById('registerEmail'),
            registerPassword: document.getElementById('registerPassword'),
            addForm: document.getElementById('addForm'),
            titleInput: document.getElementById('titleInput'),
            contentInput: document.getElementById('contentInput'),
            dataList: document.getElementById('dataList'),
            loading: document.getElementById('loading'),
            refreshBtn: document.getElementById('refreshBtn'),
            errorMessage: document.getElementById('errorMessage')
        };
    }

    setupEventListeners() {
        this.elements.loginBtn.addEventListener('click', () => this.handleGoogleLogin());
        this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());
        this.elements.loginForm.addEventListener('submit', (e) => this.handleEmailLogin(e));
        this.elements.registerForm.addEventListener('submit', (e) => this.handleEmailRegister(e));
        this.elements.addForm.addEventListener('submit', (e) => this.handleAddRecord(e));
        this.elements.refreshBtn.addEventListener('click', () => this.loadRecords());
        
        this.setupTabSwitching();
    }

    setupTabSwitching() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(targetTab + 'Tab').classList.add('active');
            });
        });
    }

    setupAuthStateListener() {
        window.addEventListener('authStateChanged', (event) => {
            const { user, isAuthenticated } = event.detail;
            this.updateAuthUI(isAuthenticated, user);
        });
    }

    initializeUI() {
        const isAuthenticated = firebaseManager.isAuthenticated();
        this.updateAuthUI(isAuthenticated, firebaseManager.getCurrentUser());
        
        if (isAuthenticated) {
            this.loadRecords();
        }
    }

    updateAuthUI(isAuthenticated, user) {
        if (isAuthenticated) {
            this.elements.authSection.style.display = 'none';
            this.elements.mainContent.style.display = 'flex';
            this.elements.statusIndicator.classList.add('authenticated');
            this.elements.statusText.textContent = `Signed in as ${user?.displayName || user?.email || 'User'}`;
        } else {
            this.elements.authSection.style.display = 'block';
            this.elements.mainContent.style.display = 'none';
            this.elements.statusIndicator.classList.remove('authenticated');
            this.elements.statusText.textContent = 'Not authenticated';
        }
    }

    async handleGoogleLogin() {
        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.signInWithGoogle();
            this.loadRecords();
        } catch (error) {
            this.showError(`Google login failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async handleEmailLogin(e) {
        e.preventDefault();
        
        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value;

        if (!email || !password) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.signInWithEmail(email, password);
            this.elements.loginForm.reset();
            this.loadRecords();
        } catch (error) {
            this.showError(`Email login failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async handleEmailRegister(e) {
        e.preventDefault();
        
        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;

        if (!email || !password) {
            this.showError('Please fill in all fields');
            return;
        }

        if (password.length < 6) {
            this.showError('Password must be at least 6 characters long');
            return;
        }

        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.createUserWithEmail(email, password);
            this.elements.registerForm.reset();
            this.loadRecords();
        } catch (error) {
            this.showError(`Registration failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async handleLogout() {
        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.signOut();
            this.records = [];
            this.renderRecords();
        } catch (error) {
            this.showError(`Logout failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async handleAddRecord(e) {
        e.preventDefault();
        
        const title = this.elements.titleInput.value.trim();
        const content = this.elements.contentInput.value.trim();

        if (!title || !content) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.addRecord(title, content);
            this.elements.addForm.reset();
            this.loadRecords();
        } catch (error) {
            this.showError(`Failed to add record: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async loadRecords() {
        try {
            this.showLoading(true);
            this.hideError();
            this.records = await firebaseManager.getRecords();
            this.renderRecords();
        } catch (error) {
            this.showError(`Failed to load records: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    renderRecords() {
        this.elements.dataList.innerHTML = '';

        if (this.records.length === 0) {
            this.elements.dataList.innerHTML = `
                <div class="empty-state">
                    <p>No records found. Add your first record above.</p>
                </div>
            `;
            return;
        }

        this.records.forEach(record => {
            const recordElement = this.createRecordElement(record);
            this.elements.dataList.appendChild(recordElement);
        });
    }

    createRecordElement(record) {
        const recordDiv = document.createElement('div');
        recordDiv.className = 'record-item';
        recordDiv.dataset.recordId = record.id;

        const createdAt = firebaseManager.formatTimestamp(record.createdAt);
        const updatedAt = record.updatedAt ? firebaseManager.formatTimestamp(record.updatedAt) : null;

        recordDiv.innerHTML = `
            <div class="record-header">
                <div class="record-title">${this.escapeHtml(record.title)}</div>
                <div class="record-actions">
                    <button class="btn btn-warning edit-btn" data-record-id="${record.id}">Edit</button>
                    <button class="btn btn-danger delete-btn" data-record-id="${record.id}">Delete</button>
                </div>
            </div>
            <div class="record-content">${this.escapeHtml(record.content)}</div>
            <div class="record-meta">
                Created: ${createdAt}
                ${updatedAt && updatedAt !== createdAt ? ` • Updated: ${updatedAt}` : ''}
            </div>
        `;

        this.attachRecordEventListeners(recordDiv, record);
        return recordDiv;
    }

    attachRecordEventListeners(recordElement, record) {
        const editBtn = recordElement.querySelector('.edit-btn');
        const deleteBtn = recordElement.querySelector('.delete-btn');

        editBtn.addEventListener('click', () => this.startEditRecord(record));
        deleteBtn.addEventListener('click', () => this.deleteRecord(record.id));
    }

    startEditRecord(record) {
        this.editingRecordId = record.id;
        
        const recordElement = document.querySelector(`[data-record-id="${record.id}"]`);
        const editForm = document.createElement('div');
        editForm.className = 'edit-form';
        editForm.innerHTML = `
            <div class="form-group">
                <label>Title:</label>
                <input type="text" class="edit-title-input" value="${this.escapeHtml(record.title)}" required>
            </div>
            <div class="form-group">
                <label>Content:</label>
                <textarea class="edit-content-input" rows="3" required>${this.escapeHtml(record.content)}</textarea>
            </div>
            <div class="edit-actions">
                <button class="btn btn-success save-edit-btn">Save</button>
                <button class="btn btn-secondary cancel-edit-btn">Cancel</button>
            </div>
        `;

        recordElement.appendChild(editForm);

        const saveBtn = editForm.querySelector('.save-edit-btn');
        const cancelBtn = editForm.querySelector('.cancel-edit-btn');

        saveBtn.addEventListener('click', () => this.saveEditRecord(record.id));
        cancelBtn.addEventListener('click', () => this.cancelEditRecord(record.id));
    }

    async saveEditRecord(recordId) {
        const recordElement = document.querySelector(`[data-record-id="${recordId}"]`);
        const titleInput = recordElement.querySelector('.edit-title-input');
        const contentInput = recordElement.querySelector('.edit-content-input');

        const title = titleInput.value.trim();
        const content = contentInput.value.trim();

        if (!title || !content) {
            this.showError('Please fill in all fields');
            return;
        }

        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.updateRecord(recordId, title, content);
            this.cancelEditRecord(recordId);
            this.loadRecords();
        } catch (error) {
            this.showError(`Failed to update record: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    cancelEditRecord(recordId) {
        const recordElement = document.querySelector(`[data-record-id="${recordId}"]`);
        const editForm = recordElement.querySelector('.edit-form');
        if (editForm) {
            editForm.remove();
        }
        this.editingRecordId = null;
    }

    async deleteRecord(recordId) {
        if (!confirm('Are you sure you want to delete this record?')) {
            return;
        }

        try {
            this.showLoading(true);
            this.hideError();
            await firebaseManager.deleteRecord(recordId);
            this.loadRecords();
        } catch (error) {
            this.showError(`Failed to delete record: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorMessage.style.display = 'block';
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        this.elements.errorMessage.style.display = 'none';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
