const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'src/pages/admin/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'src/pages/admin/admin.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'src/shared/styles/admin.css'), 'utf8');
const reportWidget = fs.readFileSync(path.join(root, 'src/shared/components/ReportWidget.js'), 'utf8');
const reportCss = fs.readFileSync(path.join(root, 'src/shared/styles/report-widget.css'), 'utf8');
const fullPageAuth = fs.readFileSync(path.join(root, 'src/shared/components/FullPageAuth.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'src/shared/components/Navigation.js'), 'utf8');
const locales = fs.readFileSync(path.join(root, 'src/shared/i18n/locales.js'), 'utf8');

assert.ok(adminHtml.includes('<html lang="ru">'), 'Admin page must declare Russian document language');
assert.ok(adminHtml.includes('id="navbar" aria-label="Основная навигация"'), 'Main nav needs an accessible name');
assert.ok(adminHtml.includes('class="sidebar-nav" aria-label="Разделы админ-панели"'), 'Admin nav needs an accessible name');
assert.ok(adminHtml.includes('id="adminSectionNav" style="display: none;"'), 'Admin nav must stay hidden before authorization');
assert.ok(adminHtml.includes('id="adminError" role="alert" aria-live="assertive"'), 'Admin errors must be announced');
assert.ok(adminHtml.includes('for="userSearchFilterInput"'), 'User search label must be associated');
assert.ok(adminHtml.includes('for="userStatusFilterSelect"'), 'User status label must be associated');
assert.ok(adminHtml.includes('id="user-page-size-select" class="page-size-select" aria-label="Строк на странице"'), 'Page size select needs an accessible name');
assert.ok(adminHtml.includes('tabindex="0" role="region" aria-label="Таблица пользователей"'), 'Users table scroll region must be keyboard reachable');
assert.ok(adminHtml.includes('id="usersCount">0 пользователей'), 'Users counter must start localized');
assert.ok(adminHtml.includes('aria-label="Подтверждение удаления пользователя"'), 'User delete modal needs localized semantics');
assert.ok(adminHtml.includes('id="confirmDeleteBtn">Удалить пользователя'), 'User delete action must be localized');
assert.ok(adminHtml.includes('id="confirmDeleteRatingBtn">Удалить оценку'), 'Rating delete action must be localized');

assert.ok(!adminJs.includes("addEventListener('mousedown'"), 'Admin controls must use click, not mousedown');
const setupIndex = adminJs.indexOf('this.setupEventListeners();');
const firstLoadIndex = adminJs.indexOf('await this.loadUsers();');
assert.ok(setupIndex !== -1 && firstLoadIndex !== -1 && setupIndex < firstLoadIndex, 'Admin controls must bind before data loads');
assert.ok(adminJs.includes('this.isAdmin = false;'), 'Admin access state must default to denied');
assert.ok(adminJs.includes('setAdminAccessState(isAdmin)'), 'Admin shell visibility must follow authorization');
assert.ok(adminJs.includes('this.setAdminAccessState(this.isAdmin);'), 'Loading completion must not reopen denied content');
assert.ok(adminJs.includes('Доступ запрещён. Для просмотра этой страницы требуются права администратора.'), 'Access errors must use Russian copy');
assert.ok(adminJs.includes('formatRussianCount'), 'Admin counters need centralized Russian pluralization');
assert.ok(adminJs.includes('Пользователи не найдены'), 'User empty state must be localized');
assert.ok(adminJs.includes('Показано <span id="user-range-start">'), 'User pagination must be localized');
assert.ok(adminJs.includes('this.displayedUsers.length > 0'), 'User pagination must avoid a 1-0 empty range');
assert.ok(adminJs.includes('this.displayedMovies.length > 0'), 'Movie pagination must avoid a 1-0 empty range');
[
    'No users found',
    'Showing <span id="user-range-start">',
    'Unknown User',
    'No email',
    'Delete User',
    'Deleting...',
    'Rating deleted successfully'
].forEach((englishUiString) => {
    assert.ok(!adminJs.includes(englishUiString), `Admin UI must not expose English string: ${englishUiString}`);
});
assert.ok(adminHtml.includes('id="adminError" role="alert" aria-live="assertive" aria-hidden="true"'), 'Admin errors need an explicit hidden state');

const loadMoviesStart = adminJs.indexOf('async loadMovies()');
const loadMoviesEnd = adminJs.indexOf('async changePage', loadMoviesStart);
const loadMoviesBody = adminJs.slice(loadMoviesStart, loadMoviesEnd);
assert.ok(loadMoviesBody.includes('this.showSkeletonRows'), 'Movie refreshes must use table skeletons');
assert.ok(!loadMoviesBody.includes('this.showLoading();'), 'Movie refreshes must not hide the admin shell');
assert.ok(adminJs.includes('renderMoviesError'), 'Movie loading failures need a visible table state');
assert.ok(adminJs.includes('this.renderApprovalsError();'), 'Approval loading failures need a visible table state');
assert.ok(adminJs.includes('clearAdminError()'), 'Admin retries must clear stale global errors');

assert.ok(reportWidget.includes('role="dialog"'), 'Report widget must expose dialog semantics');
assert.ok(reportWidget.includes('aria-modal="true"'), 'Report widget must be modal');
assert.ok(reportWidget.includes('handleDrawerKeydown'), 'Report widget must manage Escape and Tab');
assert.ok(!reportWidget.includes("addEventListener('mousedown'"), 'Report widget controls must use click');
assert.ok(reportCss.includes('color: var(--text-secondary, #a1a1aa);'), 'Report counter needs readable contrast');

assert.ok(fullPageAuth.includes('getSafeAuthErrorMessage'), 'Auth UI must map technical errors to safe copy');
assert.ok(fullPageAuth.includes("errorBanner.setAttribute('role', 'alert')"), 'Auth errors must be announced');
assert.ok(fullPageAuth.includes("wrapper.setAttribute('role', 'dialog')"), 'Auth modal needs dialog semantics');
assert.ok(fullPageAuth.includes("wrapper.setAttribute('aria-labelledby', 'fullPageAuthTitle')"), 'Auth modal needs a labelled title');
assert.ok(fullPageAuth.includes('focusTarget.focus()'), 'Auth modal must move focus into the form');
assert.ok(fullPageAuth.includes('aria-describedby="fpaLoginEmailError"'), 'Auth fields need stable error associations');
assert.ok(fullPageAuth.includes("inputEl.setAttribute('aria-invalid', 'true')"), 'Auth validation must expose invalid fields');
assert.ok(fullPageAuth.includes('role="alert" aria-live="polite"'), 'Field validation errors must be announced');
assert.ok(!fullPageAuth.includes("this.showError(`${this.t('popup.auth.loading_login'"), 'Raw login errors must not reach the UI');

assert.ok(adminCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'Admin nav needs a mobile two-column layout');
assert.ok(adminCss.includes('users-table-container:focus-visible'), 'Admin table regions need visible focus');
assert.ok(adminCss.includes('.admin-table-state-retry'), 'Table error states need styled retry controls');
assert.ok(reportCss.includes('@media (max-width: 640px)'), 'Report trigger needs a mobile safe position');
assert.ok(reportCss.includes('bottom: calc(80px + env(safe-area-inset-bottom, 0px));'), 'Mobile report trigger must leave the alert area');
assert.ok(navigation.includes("if (this.currentPage === 'admin')"), 'Admin navigation must select its Russian locale');
assert.ok(locales.includes('home: "Главная"'), 'Russian home label must exist for icon-only navigation');
assert.ok(locales.includes('open_menu: "Открыть меню"'), 'Russian mobile menu label must exist');
assert.ok(locales.includes('calendar: "Календарь"'), 'Russian calendar label must exist');

console.log('adminAccessibilityContract.test.js: all tests passed');
