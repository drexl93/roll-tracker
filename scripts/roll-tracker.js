/** TODO: 
 * SAVE ARRAY TO FILE FOR PROCESSING
 * SETTINGS - CAN PLAYERS CLEAR THEIR OWN ROLLS? TREAT FORTUNE/MISFORTUNE AS ONLY THE ROLL TAKEN OR BOTH ROLLED?
 * PRINT COMPARISON CARD OF ALL PLAYERS, HIGHLIGHT BEST/WORST
 * SEPARATE BY CHARACTER?
 * SIZE OF DICE TO BE TRACKED
 */

/**
 * A single d20 roll
 * @typedef {Object} trRoll
 * @property {string} userId - the user that made the roll
 * @property {number} roll - the actual d20 roll
 */

Hooks.on('createChatMessage', (chatMessage) => {
// Whenever a chat message is created, check if it is a d20 roll. If so, add it to the tracked array
    if (chatMessage.isRoll) {
        const d20 = chatMessage._roll.dice?.[0].faces === 20
        if (d20) {
            RollTrackerData.createTrackedRoll(chatMessage.user, chatMessage.roll)
        }
    }
})

Hooks.on('renderPlayerList', (playerList, html) => {
// This adds our icon to the player list
    if (game.user.isGM) {
    // This adds our icon to ALL players on the player list
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
    // find the element which has our logged in user's id
        const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)
    // tooltip
        const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

    // create the button where we want it to be
        loggedInUser.append(
            `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
        )
        html.on('click', `#${game.userId}`, (event) => {
            new RollTrackerDialog(game.userId).render(true);
        })
    }

})

Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
// Register our module with the Dev Mode module
    registerPackageDebugFlag(RollTracker.ID)
})

Hooks.once('init', () => {
// Initialize dialog
    RollTracker.initialize()
})

class RollTracker { 
// Store basic module info
    static ID = 'roll-tracker'

    static FLAGS = {
        ROLLS: 'rolls'
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

    static initialize() {
        this.RollTrackerDialog = new RollTrackerDialog()
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
                updatedRolls = RollTrackerData.sortRolls(updatedRolls)
            })
        } else {
            updatedRolls = newNumbers
        }
        RollTracker.log(false, updatedRolls)
        return game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.ROLLS, updatedRolls)
    }

    static clearTrackedRolls(userId) { 
    // Delete all stored rolls for a specified user ID
        return game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.ROLLS)
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
        const username = RollTrackerData.getUserRolls(userId).user.name
        const thisUserId = RollTrackerData.getUserRolls(userId).user.id
        const printRolls = RollTrackerData.getUserRolls(userId).numbers
        let stats = {}
        if (!printRolls) {
            stats.mean = 0
            stats.median = 0
            stats.mode = 0,
            stats.comparator = 0,
            stats.nat1s = 0,
            stats.nat20s = 0
        } else {
            stats = RollTrackerData.calculate(printRolls)
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

    // How many Nat1s or Nat20s do we have?
        const nat1s = modeObj[1] || 0
        const nat20s = modeObj[20] || 0

        return {
            mean,
            median,
            mode,
            comparator,
            nat1s,
            nat20s,
        }
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
                await RollTrackerData.clearTrackedRolls(userId)
                this.render();
                break
            }
        }
    }
}