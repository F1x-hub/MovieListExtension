import assert from 'node:assert';
import fs from 'node:fs';
import { 
    formatDateISO, 
    formatDateHuman,
    CustomDatePicker,
    CustomTimePicker
} from '../src/shared/components/CustomDateTimePicker.js';

console.log('🧪 Running Custom Date & Time Picker Tests...');

// 1. Formatting Helpers Tests
console.log('  1. Testing Date & Time Formatting Helpers...');
const d1 = new Date(2026, 7, 18); // August 18, 2026
assert.equal(formatDateISO(d1), '2026-08-18', 'formatDateISO must format as YYYY-MM-DD');
assert.equal(formatDateHuman(d1), '18 авг. 2026', 'formatDateHuman must format Date object in Russian');
assert.equal(formatDateHuman('2026-08-18'), '18 авг. 2026', 'formatDateHuman must format YYYY-MM-DD string in Russian');

// 2. Mock DOM Environment for functional tests
console.log('  2. Testing CustomDatePicker lifecycle & state...');

class MockClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
}

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.innerHTML = '';
        this.classList = new MockClassList();
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.dataset = {};
        this.value = '';
        this.textContent = '';
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }
    dispatchEvent(event) {
        const fns = this.listeners[event.type || event] || [];
        fns.forEach(fn => fn(event));
    }
    querySelector(selector) {
        if (selector === '.custom-picker-trigger') return this._trigger || (this._trigger = new MockElement('button'));
        if (selector === '.custom-picker-value') return this._valueDisplay || (this._valueDisplay = new MockElement('span'));
        if (selector === '.custom-time-direct-input') return this._directInput || (this._directInput = new MockElement('input'));
        if (selector === '.custom-date-picker-dropdown' || selector === '.custom-time-picker-dropdown') {
            return this._dropdown || (this._dropdown = new MockElement('div'));
        }
        return new MockElement('div');
    }
    querySelectorAll() { return []; }
    contains() { return false; }
    scrollIntoView() {}
}

const container = new MockElement('div');
const targetInput = new MockElement('input');

global.document = {
    addEventListener: () => {},
    removeEventListener: () => {}
};
global.requestAnimationFrame = (cb) => cb();

const datePicker = new CustomDatePicker({
    container,
    targetInput,
    initialValue: '2026-08-18'
});

assert.equal(datePicker.getValue(), '2026-08-18', 'getValue must return initial value');
assert.equal(targetInput.value, '2026-08-18', 'targetInput.value must be synchronized');

datePicker.nextMonth();
assert.equal(datePicker.viewMonth, 8, 'nextMonth must advance viewMonth to September');
datePicker.prevMonth();
assert.equal(datePicker.viewMonth, 7, 'prevMonth must retreat viewMonth to August');

datePicker.setValue('2026-09-01');
assert.equal(datePicker.getValue(), '2026-09-01', 'setValue must update selected date');
assert.equal(targetInput.value, '2026-09-01', 'setValue must update targetInput');

console.log('  3. Testing CustomTimePicker lifecycle & state...');
const timeContainer = new MockElement('div');
const timeTargetInput = new MockElement('input');

const timePicker = new CustomTimePicker({
    container: timeContainer,
    targetInput: timeTargetInput,
    initialValue: '14:30'
});

assert.equal(timePicker.getValue(), '14:30', 'timePicker getValue must return initial 14:30');
assert.equal(timeTargetInput.value, '14:30', 'timePicker must sync value to targetInput');

timePicker.setTime(18, 45);
assert.equal(timePicker.getValue(), '18:45', 'setTime(18, 45) must update value');
assert.equal(timeTargetInput.value, '18:45', 'setTime must sync to targetInput');

timePicker.setValue('09:15');
assert.equal(timePicker.getValue(), '09:15', 'setValue(09:15) must update value');
assert.equal(timeTargetInput.value, '09:15', 'setValue must sync to targetInput');

// Test add and remove custom preset
timePicker.addPreset('19:45');
assert.ok(timePicker.savedPresets.includes('19:45'), 'addPreset must add 19:45 to savedPresets');
timePicker.removePreset('19:45');
assert.ok(!timePicker.savedPresets.includes('19:45'), 'removePreset must remove 19:45 from savedPresets');

// 4. Static File and Markup Contracts
console.log('  4. Testing HTML, CSS & JS integration contracts...');
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const movieDetailsHtml = read('../src/pages/movie-details/movie-details.html');
const movieDetailsJs = read('../src/pages/movie-details/movie-details.js');
const customPickerCss = read('../src/shared/styles/custom-picker.css');

assert.match(movieDetailsHtml, /custom-picker\.css/, 'movie-details.html must include custom-picker.css');
assert.match(movieDetailsHtml, /id="announceDateContainer"/, 'movie-details.html must include announceDateContainer mount');
assert.match(movieDetailsHtml, /id="announceTimeContainer"/, 'movie-details.html must include announceTimeContainer mount');
assert.match(movieDetailsJs, /CustomDatePicker,\s*CustomTimePicker/, 'movie-details.js must import CustomDatePicker and CustomTimePicker');
assert.match(customPickerCss, /\.custom-date-picker-dropdown/, 'custom-picker.css must define date picker dropdown');
assert.match(customPickerCss, /\.custom-time-picker-dropdown/, 'custom-picker.css must define time picker dropdown');

console.log('🎉 ALL Custom Date & Time Picker Tests Passed Successfully!');
