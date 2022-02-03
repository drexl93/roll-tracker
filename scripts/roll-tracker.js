/** TODO: 
 * SETTINGS - CAN PLAYERS CLEAR THEIR OWN ROLLS? TREAT FORTUNE/MISFORTUNE AS ONLY THE ROLL TAKEN OR BOTH ROLLED?
 * * HAVE CHECKBOXES FOR WHAT KIND OF ROLLS ARE CONSIDERED - VERY SYSTEM SPECIFIC
 * PRINT COMPARISON CARD OF ALL PLAYERS, HIGHLIGHT BEST/WORST
 * SEPARATE BY CHARACTER?
 * SIZE OF DICE TO BE TRACKED
 */

/** QUESTIONS:
 * HANDLEBAR MULTIMODAL FUNCTION?
 */

// Whenever a chat message is created, check if it is a d20 roll. If so, add it to the tracked array
Hooks.on('createChatMessage', (chatMessage) => {
    if (chatMessage.isRoll) {
        const d20 = chatMessage._roll.dice?.[0].faces === 20
        if (d20) {
            RollTrackerData.createTrackedRoll(chatMessage.user, chatMessage.roll)
        }
    }
})

// This adds our icon to the player list
Hooks.on('renderPlayerList', (playerList, html) => {

    // This adds our icon to ALL players on the player list, if the setting is toggled
    if (game.user.isGM && game.settings.get(RollTracker.ID, RollTracker.SETTINGS.GM_SEE_PLAYERS)) {
    
    // tooltip
        const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')
    // create the button where we want it to be
        for (let user of game.users) {
            const buttonPlacement = html.find(`[data-user-id="${user.id}"]`)
            buttonPlacement.append(
                `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${user.id}"><i class="fas fa-dice-d20"></i></button>`
            )
            html.on('click', `#${user.id}`, (event) => {
                new RollTrackerDialog(user.id).render(true);
            })
        }
    } else {
    // find the element which has our logged in user's id */
        const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)

        const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

        loggedInUser.append(
            `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
        )
        html.on('click', `#${game.userId}`, (event) => {
            new RollTrackerDialog(game.userId).render(true);
        })
    }

})

// Register our module with the Dev Mode module
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(RollTracker.ID)
})

// Initialize dialog
Hooks.once('init', () => {
    RollTracker.initialize()
})


/** Just a helper handlebars function so for our "Mode" line in the FormApp, if there is exactly 1
    instance of a mode, the text will read "instance" as opposed to "instances" */
Handlebars.registerHelper('isOne', function (value) {
    return value === 1;
});

/** Just a helper handlebars function so for our "Mode" line in the FormApp, if there is more than 1 
    mode, the text will read ".... instances *each*" as opposed to "... instances" 
Handlebars.registerHelper('isMultimodal', function (value) {
    return value.length > 1;
}); */

// Store basic module info
class RollTracker { 
    static ID = 'roll-tracker'

    static FLAGS = {
        ROLLS: 'rolls',
        EXPORT: 'export'
    }

    static TEMPLATES = {
        ROLLTRACK: `modules/${this.ID}/templates/${this.ID}.hbs`
    }

    static log(force, ...args) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.ID)

        if (shouldLog) {
            console.log(this.ID, '|', ...args)
        }
    }

    static SETTINGS = {
        GM_SEE_PLAYERS: 'gm_see_players'
    }

    static initialize() {
        this.RollTrackerDialog = new RollTrackerDialog()

        game.settings.register(this.ID, this.SETTINGS.GM_SEE_PLAYERS, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Hint`,
            onChange: () => ui.players.render()
        })
    }
}

class RollTrackerData { 
// Our main data workhorse
    static getUserRolls(userId) {
    // A simple retrieve method that gets the stored flag on a specified user
         const output = {
            user: game.users.get(userId),    
            numbers: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.ROLLS)
        } 
        return output
    }

    static createTrackedRoll(user, rollData) {
    // Make an object for storage, making sure to include the name and ID to be used later
        let updatedRolls = []
    // extract the new rolls from the chat message, concatenate the array with the existing rolls array
        const newNumbers = rollData.dice[0].results.map(result => result.result) // In case there's more than one d20 roll in a single instance as in fortune/misfortune rolls
        const oldNumbers = this.getUserRolls(user.id)?.numbers
        if (oldNumbers) { // if there are pre-existing stored rolls, merge the two arrays
            updatedRolls = [...oldNumbers]
            newNumbers.forEach(e => {
                updatedRolls.unshift(e)
                updatedRolls = this.sortRolls(updatedRolls)
            })
        } else {
            updatedRolls = newNumbers
        }
        return game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.ROLLS, updatedRolls)
    }

    static clearTrackedRolls(userId) { 
    // Delete all stored rolls for a specified user ID
        return Promise.all([
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.ROLLS), 
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT)
        ])
    }

    static sortRolls(rolls) {
        for (let i = 0; i < rolls.length; i++) {
            if (rolls[i+1] && (rolls[i] > rolls[i+1])) {
                let higherVal = rolls[i]
                let lowerVal = rolls[i+1]
                rolls.splice(i, 1, lowerVal)
                rolls.splice(i+1, 1, higherVal)
            } else {
                return rolls
            }
        } 
    }

    static printTrackedRolls(userId) { 
    // Package for data access via the FormApplication
        const username = this.getUserRolls(userId).user.name
        const thisUserId = this.getUserRolls(userId).user.id
        const printRolls = this.getUserRolls(userId).numbers
        let stats = {}
        if (!printRolls) {
            stats.mean = 0
            stats.median = 0
            stats.mode = 0,
            stats.comparator = 0,
            stats.nat1s = 0,
            stats.nat20s = 0
        } else {
            stats = this.calculate(printRolls)
        }
        return { username, thisUserId, stats }
    }

    static calculate(rolls) {
    // Turn the raw data array into usable stats
    // Mean
        const sum = rolls.reduce((firstValue, secondValue) => {
            return firstValue + secondValue
        })
        const mean = Math.round(sum / rolls.length)

    // Median
        // We've already sorted the rolls as they've come in
        const medianPosition = Math.round(rolls.length / 2)
        const median = rolls[medianPosition-1]

    // Mode
        let modeObj = {}
        rolls.forEach(e => {
            if (!modeObj[e]) {
                modeObj[e] = 1
            } else {
                modeObj[e]++
            }
        })
        this.prepareExportData(modeObj)
        let comparator = 0
        let mode = []
        for (let rollNumber in modeObj) {
            if (modeObj[rollNumber] > comparator) {
                comparator = modeObj[rollNumber]
                mode.splice(0)
                mode.push(rollNumber)
            } else if (modeObj[rollNumber] === comparator) {
                mode.push(rollNumber)
            }
        }
        const modeString = mode.join(', ')

    // How many Nat1s or Nat20s do we have?
        const nat1s = modeObj[1] || 0
        const nat20s = modeObj[20] || 0

        return {
            mean,
            median,
            mode: modeString,
            comparator,
            nat1s,
            nat20s,
        }
    }

    static prepareExportData(data) {
    // prepare the roll data for export to an R-friendly text file
        const keys = Object.keys(data)
        let fileContent = ``
        for (let key of keys) {
            fileContent += `${key},${data[key]}\n`
        }
        game.users.get(game.userId)?.setFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT, fileContent)
    }
}

class RollTrackerDialog extends FormApplication {
    constructor(userId, options={}) {  
    // the first argument is the object, the second are the options
        super(userId, options)
    }

    static get defaultOptions() {
        const defaults = super.defaultOptions
        const overrides = {
            height: 'auto',
            id: 'roll-tracker',
            template: RollTracker.TEMPLATES.ROLLTRACK,
            title: 'Roll Tracker',
        }
        const mergedOptions = foundry.utils.mergeObject(defaults, overrides);
        return mergedOptions
    }

    getData() {
        return RollTrackerData.printTrackedRolls(this.object)
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.on('click', "[data-action]", this._handleButtonClick.bind(this))
    }

    async _handleButtonClick(event) {
        const clickedElement = $(event.currentTarget)
        const action = clickedElement.data().action
        const userId = clickedElement.parents(`[data-userId]`)?.data().userid
        switch (action) {
            case 'clear': {
                const confirmed = await Dialog.confirm({
                    title: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.title"),
                    content: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.content"),
                })
                if (confirmed) {
                    await RollTrackerData.clearTrackedRolls(userId)
                    this.render();
                }
                break
            }
        }
    }

    get exportData() {
        return game.users.get(game.userId).getFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT)
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons.splice(0, 0, {
            class: "roll-tracker-form-export",
            icon: "fas fa-download",
            // label: `ROLL-TRACKER.form-button-download`,
            onclick: ev => {
                if (this.exportData) {
                    saveDataToFile(this.exportData, 'string', 'roll-data.txt')
                } else {
                    return ui.notifications.warn("No roll data to export")
                }
            }
        })
        return buttons
    }

}