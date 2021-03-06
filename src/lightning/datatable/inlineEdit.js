import {
    startPositioning,
    stopPositioning,
    Direction,
} from 'lightning/positionLibrary';
import {
    setFocusActiveCell,
    reactToTabBackward,
    reactToTabForward,
    getActiveCellElement,
    getCellElementByIndexes,
    updateActiveCell,
} from './keyboard';
import { updateRowsAndCellIndexes, getRowByKey, getKeyField } from './rows';
import {
    getColumnIndexByColumnKey,
    getColumns,
    getStateColumnIndex,
    getEditableColumns,
} from './columns';
import { setErrors } from './errors';
import {
    markDeselectedCell,
    markSelectedCell,
    isSelectedRow,
    getCurrentSelectionLength,
    getSelectedRowsKeys,
} from './selector';

export { getDirtyValue } from './inlineEdit-shared';

const PANEL_SEL = '[data-iedit-panel="true"]';

export function getInlineEditDefaultState() {
    return {
        inlineEdit: {
            dirtyValues: {},
        },
    };
}

/**
 * @param {Object} state - Datatable instance.
 * @return {Array} - An array of objects, each object describing the dirty values in the form { colName : dirtyValue }.
 *                   A special key is the { [keyField]: value } pair used to identify the row containing this changed values.
 */
export function getDirtyValues(state) {
    return getChangesForCustomer(state, state.inlineEdit.dirtyValues);
}

/**
 * Sets the dirty values in the datatable.
 *
 * @param {Object} state Datatable state for the inline edit.
 * @param {Array} value An array of objects, each object describing the dirty values in the form { colName : dirtyValue }.
 *                      A special key is the { [keyField]: value } pair used to identify the row containing this changed values.
 */
export function setDirtyValues(state, value) {
    const keyField = getKeyField(state);
    const dirtyValues = Array.isArray(value) ? value : [];

    state.inlineEdit.dirtyValues = dirtyValues.reduce((result, rowValues) => {
        const changes = getRowChangesFromCustomer(state, rowValues);
        delete changes[keyField];

        result[rowValues[keyField]] = changes;

        return result;
    }, {});
}

export function isInlineEditTriggered(state) {
    return Object.keys(state.inlineEdit.dirtyValues).length > 0;
}

export function cancelInlineEdit(dt) {
    dt.state.inlineEdit.dirtyValues = {};
    setErrors(dt.state, {});
    updateRowsAndCellIndexes.call(dt);
}

/**
 * An event handler for open inline edit flows that are triggered by datatable cells
 *
 * @param {CustomEvent} event - An object representing the event that was fired by the datatable cell for
 *                              which to open the inline edit panel. Must be valid and truthy.
 */
export function handleEditCell(event) {
    openInlineEdit(this, event.target);
}

/**
 * Attempts to open the inline edit panel for the datatable's currently active cell. If the active cell is not
 * editable, then the panel is instead opened for the first editable cell in the table. Used to open inline edit
 * in a direct, programmatic fashion.
 *
 * If there is no data in the table or there are no editable cells in the table then calling this function
 * results in a no-op.
 *
 * @param {Object} dt - The datatable instance. Must be a truthy and valid datatable reference.
 */
export function openInlineEditOnActiveCell(dt) {
    const hasData = dt.state.data && dt.state.data.length > 0;
    if (hasData) {
        const activeCellElement = getActiveCellElement(dt.template, dt.state);
        const isEditable = activeCellElement.editable;
        if (isEditable) {
            setFocusAndOpenInlineEdit(dt, activeCellElement);
        } else {
            const firstEditableCell = getFirstEditableCell(dt);
            if (firstEditableCell) {
                updateActiveCell(
                    dt.state,
                    firstEditableCell.rowKeyValue,
                    firstEditableCell.colKeyValue
                );
                setFocusAndOpenInlineEdit(dt, firstEditableCell);
            }
        }
    }
}

/**
 * async function to await setting focus on an editable cell before opening inline-edit panel
 * @param {Object} dt - The datatable instance
 * @param {Object} cell - editable cell to be focused before open inline-edit panel
 */
// eslint-disable-next-line @lwc/lwc/no-async-await
async function setFocusAndOpenInlineEdit(dt, cell) {
    await setFocusActiveCell(dt.template, dt.state, 0);
    openInlineEdit(dt, cell);
}

/**
 * Returns a reference to the first editable cell in the table. If no editable cells exist in the table
 * then undefined is returned.
 *
 * @param {Object} dt - The datatable instance. Must be a truthy and valid datatable reference.
 */
function getFirstEditableCell(dt) {
    const columns = getColumns(dt.state);
    const editableColumns = getEditableColumns(columns);

    if (editableColumns.length > 0) {
        const rows = dt.state.rows;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            for (let i = 0; i < editableColumns.length; i++) {
                // Loop through the editable columns in order and examine the corresponding cells
                // in the current row for editability, returning the first such cell that is editable
                const editableColumn = editableColumns[i];
                const editableColumnIndex = getStateColumnIndex(
                    dt.state,
                    editableColumn.colKeyValue
                );
                const cell = getCellElementByIndexes(
                    dt.template,
                    rowIndex,
                    editableColumnIndex
                );
                if (cell.editable) {
                    return cell;
                }
            }
        }
    }

    return undefined;
}

/**
 * Opens the inline edit panel for the given target element. This function is the endpoint of all
 * event-driven open inline edit flows but can also be used to open the inline edit panel in a direct
 * programmatic fashion.
 *
 * @param {Object} dt - The datatable instance. Must be a truthy and valid datatable reference.
 * @param {Object} target - The LWC component instance representing the cell in the datatable for which
 *                          the inline edit panel is to be opened. Must be a truthy and valid reference.
 */
function openInlineEdit(dt, target) {
    startPanelPositioning(dt, target.parentElement);

    const { state, template } = dt;
    const inlineEdit = state.inlineEdit;

    if (inlineEdit.isPanelVisible) {
        // A special case when we are trying to open a edit but we have one open. (click on another edit while editing)
        // in this case we will need to process the values before re-open the edit panel with the new values or we may lose the edition.
        processInlineEditFinish(
            dt,
            'loosed-focus',
            inlineEdit.rowKeyValue,
            inlineEdit.colKeyValue
        );
    }

    const { rowKeyValue, colKeyValue } = target;

    inlineEdit.isPanelVisible = true;
    inlineEdit.rowKeyValue = rowKeyValue;
    inlineEdit.colKeyValue = colKeyValue;
    inlineEdit.editedValue = getCellValue(state, rowKeyValue, colKeyValue);
    inlineEdit.massEditSelectedRows = getCurrentSelectionLength(state);
    inlineEdit.massEditEnabled =
        isSelectedRow(state, rowKeyValue) &&
        inlineEdit.massEditSelectedRows > 1;

    // pass the column definition
    const colIndex = getStateColumnIndex(state, colKeyValue);
    inlineEdit.columnDef = getColumns(state)[colIndex];

    markSelectedCell(state, rowKeyValue, colKeyValue);

    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
        template
            .querySelector('lightning-primitive-datatable-iedit-panel')
            .focus();
    }, 0);
}

export function handleInlineEditFinish(event) {
    stopPanelPositioning(this);

    const { reason, rowKeyValue, colKeyValue } = event.detail;

    processInlineEditFinish(this, reason, rowKeyValue, colKeyValue);
}

export function handleMassCheckboxChange(event) {
    const state = this.state;
    if (event.detail.checked) {
        markAllSelectedRowsAsSelectedCell(state);
    } else {
        markAllSelectedRowsAsDeselectedCell(this.state);
        markSelectedCell(
            state,
            state.inlineEdit.rowKeyValue,
            state.inlineEdit.colKeyValue
        );
    }
}

// hide panel on scroll
const HIDE_PANEL_THRESHOLD = 5;
export function handleInlineEditPanelScroll(event) {
    const { isPanelVisible, rowKeyValue, colKeyValue } = this.state.inlineEdit;

    if (!isPanelVisible) {
        return;
    }

    let delta = 0;

    const container = event.target;
    if (container.classList.contains('slds-scrollable_x')) {
        const scrollX = container.scrollLeft;
        if (this.privateLastScrollX == null) {
            this.privateLastScrollX = scrollX;
        } else {
            delta = Math.abs(this.privateLastScrollX - scrollX);
        }
    } else {
        const scrollY = container.scrollTop;
        if (this.privateLastScrollY == null) {
            this.privateLastScrollY = scrollY;
        } else {
            delta = Math.abs(this.privateLastScrollY - scrollY);
        }
    }

    if (delta > HIDE_PANEL_THRESHOLD) {
        this.privateLastScrollX = null;
        this.privateLastScrollY = null;
        stopPanelPositioning(this);
        processInlineEditFinish(this, 'loosed-focus', rowKeyValue, colKeyValue);
    } else {
        // we want to keep the panel attached to the cell before
        // reaching the threshold and hiding the panel
        repositionPanel(this);
    }
}

/**
 * Will update the dirty values specified in rowColKeyValues
 *
 * @param {Object} state - state of the datatable
 * @param {Object} rowColKeyValues - An object in the form of { rowKeyValue: { colKeyValue1: value, ..., colKeyValueN: value } ... }
 */
function updateDirtyValues(state, rowColKeyValues) {
    const dirtyValues = state.inlineEdit.dirtyValues;

    Object.keys(rowColKeyValues).forEach((rowKey) => {
        if (!Object.prototype.hasOwnProperty.call(dirtyValues, rowKey)) {
            dirtyValues[rowKey] = {};
        }

        Object.assign(dirtyValues[rowKey], rowColKeyValues[rowKey]);
    });
}

/**
 * Returns the current value of the cell, already takes into account the dirty value
 *
 * @param {Object} state - state of the datatable
 * @param {String} rowKeyValue - row key
 * @param {String} colKeyValue - column key
 *
 * @return {Object} the value for the current cell.
 */
function getCellValue(state, rowKeyValue, colKeyValue) {
    const row = getRowByKey(state, rowKeyValue);
    const colIndex = getStateColumnIndex(state, colKeyValue);

    return row.cells[colIndex].value;
}

/**
 *
 * @param {Object} state - Datatable state
 * @param {Object} changes - The internal representation of changes in a row
 * @returns {Object} - the list of customer changes in a row
 */
function getColumnsChangesForCustomer(state, changes) {
    return Object.keys(changes).reduce((result, colKey) => {
        const columns = getColumns(state);
        const columnIndex = getStateColumnIndex(state, colKey);
        const columnDef = columns[columnIndex];

        result[columnDef.columnKey || columnDef.fieldName] = changes[colKey];

        return result;
    }, {});
}

function getRowChangesFromCustomer(state, changes) {
    return Object.keys(changes).reduce((result, externalColumnKey) => {
        const columns = getColumns(state);
        const columnIndex = getColumnIndexByColumnKey(state, externalColumnKey);

        if (columnIndex >= 0) {
            const colKey = columns[columnIndex].colKeyValue;
            result[colKey] = changes[externalColumnKey];
        }

        return result;
    }, {});
}

function getChangesForCustomer(state, changes) {
    const keyField = getKeyField(state);

    return Object.keys(changes).reduce((result, rowKey) => {
        const rowChanges = getColumnsChangesForCustomer(state, changes[rowKey]);

        if (Object.keys(rowChanges).length > 0) {
            rowChanges[keyField] = rowKey;

            result.push(rowChanges);
        }

        return result;
    }, []);
}

function dispatchCellChangeEvent(dtInstance, cellChange) {
    dtInstance.dispatchEvent(
        new CustomEvent('cellchange', {
            detail: {
                draftValues: getChangesForCustomer(
                    dtInstance.state,
                    cellChange
                ),
            },
        })
    );
}

export function closeInlineEdit(dt) {
    const inlineEditState = dt.state.inlineEdit;

    if (inlineEditState.isPanelVisible) {
        processInlineEditFinish(
            dt,
            'loosed-focus',
            inlineEditState.rowKeyValue,
            inlineEditState.colKeyValue
        );
    }
}

function isValidCell(state, rowKeyValue, colKeyValue) {
    const row = getRowByKey(state, rowKeyValue);
    const colIndex = getStateColumnIndex(state, colKeyValue);

    return row && row.cells[colIndex];
}

/**
 * It will process when the datatable had finished an edition.
 *
 * @param {Object} dt - the datatable instance
 * @param {string} reason - the reason to finish the edition. valid reasons are: edit-canceled | loosed-focus | tab-pressed | submit-action
 * @param {string} rowKeyValue - the row key of the edited cell
 * @param {string} colKeyValue - the column key of the edited cell
 */
function processInlineEditFinish(dt, reason, rowKeyValue, colKeyValue) {
    const state = dt.state;
    const inlineEditState = state.inlineEdit;

    const shouldSaveData =
        reason !== 'edit-canceled' &&
        !(inlineEditState.massEditEnabled && reason === 'loosed-focus') &&
        isValidCell(dt.state, rowKeyValue, colKeyValue);

    if (shouldSaveData) {
        const panel = dt.template.querySelector(PANEL_SEL);
        const editValue = panel.value;
        const isValidEditValue = panel.validity.valid;
        const updateAllSelectedRows = panel.isMassEditChecked;
        const currentValue = getCellValue(state, rowKeyValue, colKeyValue);

        if (
            isValidEditValue &&
            (editValue !== currentValue || updateAllSelectedRows)
        ) {
            const cellChange = {};
            cellChange[rowKeyValue] = {};
            cellChange[rowKeyValue][colKeyValue] = editValue;

            if (updateAllSelectedRows) {
                const selectedRowKeys = getSelectedRowsKeys(state);
                selectedRowKeys.forEach((rowKey) => {
                    cellChange[rowKey] = {};
                    cellChange[rowKey][colKeyValue] = editValue;
                });
            }

            updateDirtyValues(state, cellChange);

            dispatchCellChangeEvent(dt, cellChange);

            // @todo: do we need to update all rows in the dt or just the one that was modified?
            updateRowsAndCellIndexes.call(dt);
        }
    }

    if (reason !== 'loosed-focus') {
        switch (reason) {
            case 'tab-pressed-next': {
                reactToTabForward(dt.template, state);
                break;
            }
            case 'tab-pressed-prev': {
                reactToTabBackward(dt.template, state);
                break;
            }
            default: {
                setFocusActiveCell(dt.template, state, 0);
            }
        }
    }

    markAllSelectedRowsAsDeselectedCell(state);
    markDeselectedCell(state, rowKeyValue, colKeyValue);

    inlineEditState.isPanelVisible = false;
}

function startPanelPositioning(dt, target) {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    requestAnimationFrame(() => {
        // we need to discard previous binding otherwise the panel
        // will retain previous alignment
        stopPanelPositioning(dt);

        dt.privatePositionRelationship = startPositioning(dt, {
            target,
            element: () =>
                dt.template.querySelector(PANEL_SEL).getPositionedElement(),
            align: {
                horizontal: Direction.Left,
                vertical: Direction.Top,
            },
            targetAlign: {
                horizontal: Direction.Left,
                vertical: Direction.Top,
            },
            autoFlip: true,
        });
    });
}

function stopPanelPositioning(dt) {
    if (dt.privatePositionRelationship) {
        stopPositioning(dt.privatePositionRelationship);
        dt.privatePositionRelationship = null;
    }
}

// reposition inline edit panel
// this does not realign the element, so it doesn't fix alignment
// when size of panel changes
function repositionPanel(dt) {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    requestAnimationFrame(() => {
        if (dt.privatePositionRelationship) {
            dt.privatePositionRelationship.reposition();
        }
    });
}

function markAllSelectedRowsAsSelectedCell(state) {
    const { colKeyValue } = state.inlineEdit;
    const selectedRowKeys = getSelectedRowsKeys(state);

    selectedRowKeys.forEach((rowKeyValue) => {
        markSelectedCell(state, rowKeyValue, colKeyValue);
    });
}

function markAllSelectedRowsAsDeselectedCell(state) {
    const { colKeyValue } = state.inlineEdit;
    const selectedRowKeys = getSelectedRowsKeys(state);

    selectedRowKeys.forEach((rowKeyValue) => {
        markDeselectedCell(state, rowKeyValue, colKeyValue);
    });
}
