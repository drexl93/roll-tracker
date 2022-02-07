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
        RollTracker.parseMessage(chatMessage, RollTracker.SYSTEM)
    }
})

// This adds our icon to the player list
Hooks.on('renderPlayerList', (playerList, html) => {

    if (game.user.isGM) {
        if (game.settings.get(RollTracker.ID, RollTracker.SETTINGS.GM_SEE_PLAYERS)) {
            // This adds our icon to ALL players on the player list, if the setting is toggled
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
            }
        else {
            // Just put the icon near the GM's name
            const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)

            const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

            loggedInUser.append(
                `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
            )
            html.on('click', `#${game.userId}`, (event) => {
                new RollTrackerDialog(game.userId).render(true);
            })
        }
    }
     else if (game.settings.get(RollTracker.ID, RollTracker.SETTINGS.PLAYERS_SEE_PLAYERS)) {
    // find the element which has our logged in user's id
        const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)

        const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

        loggedInUser.append(
            `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
        )
        html.on('click', `#${game.userId}`, (event) => {
            // if (RollTrackerData.getUserRolls(game.userId)?.sorted?.length >= 10) {
                new RollTrackerDialog(game.userId).render(true);
            // }
            // else {
            //     ui.notifications.warn("Minimum 10 recorded rolls needed.")
            // }
        })
    }
})

// Register our module with the Dev Mode module, for logging purposes
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(RollTracker.ID)
})

// Initialize dialog and settings on foundry boot up
Hooks.once('init', () => {
    RollTracker.initialize()
})


// Just a helper handlebars function so for our "Mode" line in the FormApp, if there is exactly 1
// instance of a mode, the text will read "instance" as opposed to "instances"
Handlebars.registerHelper('isOne', function (value) {
    return value === 1;
});

/** NOT YET FUNCTIONAL */
// Just a helper handlebars function so for our "Mode" line in the FormApp, if there is more than 1 
// mode, the text will read ".... instances *each*" as opposed to "... instances" 
// Handlebars.registerHelper('isMultimodal', function (value) {
//     return value.length > 1;
// });

// Store basic module info
class RollTracker { 
    static ID = 'roll-tracker'

    static FLAGS = {
        SORTED: 'sorted',
        EXPORT: 'export',
        UNSORTED: 'unsorted',
        STREAK: 'streak'
    }

    static TEMPLATES = {
        ROLLTRACK: `modules/${this.ID}/templates/${this.ID}.hbs`,
        CHATMSG: `modules/${this.ID}/templates/${this.ID}-chat.hbs`
    }

    // This logging function ties in with the Developer Mode module. It will log a custom, module namespaced
    // message in the dev console when RollTracker.log() is called. When Developer Mode is not enabled (as in
    // most non-dev environments) the log will not show. Prevents logs leaking into full releases
    static log(force, ...args) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.ID)

        if (shouldLog) {
            console.log(this.ID, '|', ...args)
        }
    }

    static SETTINGS = {
        GM_SEE_PLAYERS: 'gm_see_players',
        PLAYERS_SEE_PLAYERS: 'players_see_players',
        ROLL_STORAGE: 'roll_storage',
        COUNT_HIDDEN: 'count_hidden',
        DND5E: {
            RESTRICT_COUNTED_ROLLS: 'restrict_counted_rolls'
        }
    }

    // static SYSTEM = { 
    //     SYSTEM: `${game.system.id}`
    // }


    static initialize() {
        // Store the current system, for settings purposes
        this.SYSTEM = `${game.system.id}`

        // Cache an instance of the dialog that pops up when we click the dice button near a player
        // name on the playerlist. Its contents are updated at the actual time of clicking
        // this.RollTrackerDialog = new RollTrackerDialog()

        // this.RollTrackerStreakMessage = new RollTrackerStreakMessage()

        // A setting to toggle whether the GM can see the icon allowing them access to player roll
        // data or not
        game.settings.register(this.ID, this.SETTINGS.GM_SEE_PLAYERS, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Hint`,
            onChange: () => ui.players.render()
        })

        // A setting to determine how many rolls should be stored at any one time
        game.settings.register(this.ID, this.SETTINGS.ROLL_STORAGE, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.ROLL_STORAGE}.Name`,
            default: 50,
            type: Number,
            range: {
                min: 10,
                max: 500,
                step: 10
            },
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.ROLL_STORAGE}.Hint`,
        })

        // A setting to determine whether players can see their own tracked rolls
        game.settings.register(this.ID, this.SETTINGS.PLAYERS_SEE_PLAYERS, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.PLAYERS_SEE_PLAYERS}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.PLAYERS_SEE_PLAYERS}.Hint`,
            onChange: () => ui.players.render()
        })

        game.settings.register(this.ID, this.SETTINGS.COUNT_HIDDEN, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Hint`,
        })

        switch(game.system.id) {
            case 'dnd5e':
                game.settings.register(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS, {
                    name: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Name`,
                    default: true,
                    type: Boolean,
                    scope: 'world',
                    config: true,
                    hint: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Hint`,
                })
                break;
        } 
    }

    static parseMessage(chatMessage, system) {
        const isBlind = chatMessage.data.blind
        const rollRequirements = {
            isd20: chatMessage._roll.dice?.[0].faces === 20,
            blindCheck: (!isBlind) || (isBlind && game.settings.get(this.ID, this.SETTINGS.COUNT_HIDDEN)) || (isBlind && game.users.get(chatMessage.user.id)?.isGM),
        }
        this.log(false, 'rollRequirements', rollRequirements)
        switch (system) {
            case 'dnd5e':
                if (game.settings.get(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS)) {
                    if (chatMessage.data.flags.dnd5e?.roll?.type) {
                        rollRequirements.dnd5e_restrict_passed = true
                    } else {
                        rollRequirements.dnd5e_restrict_passed = false
                    }
                }
                break;
        }
        const checksPassed = Object.values(rollRequirements).every(check => {
            return check === true
        })            
        this.log(false, 'checksPassed', checksPassed)
        if (checksPassed) {
            RollTrackerData.createTrackedRoll(chatMessage.user, chatMessage.roll)
        }
    }
}

class RollTrackerData { 
// Our main data workhorse class
    static getUserRolls(userId) {
    // A simple retrieve method that gets the stored flag on a specified user
         const output = {
            user: game.users.get(userId),    
            sorted: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.SORTED),
            unsorted: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED),
            export: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT),
            streak: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
        } 
        return output
    }

    static createTrackedRoll(user, rollData) {
        if (game.userId === user.id) {
        // this check is necessary because (I think) every instance of foundry currently running tries
        // to create and update these rolls. Players, however, do not have permission to edit the data
        // of other users, so errors are thrown. This way the only foundry instance that creates the tracked
        // roll is the foundry instance of the user actually making the roll
            let updatedRolls = []
            const newNumbers = rollData.dice[0].results.map(result => result.result) // In case there's more than one d20 roll in a single instance as in fortune/misfortune rolls
            let oldSorted = this.getUserRolls(user.id)?.sorted || []
            let oldUnsorted = this.getUserRolls(user.id)?.unsorted || []
            const limit = game.settings.get(RollTracker.ID, RollTracker.SETTINGS.ROLL_STORAGE)
            if (oldUnsorted.length >= limit) {
                const difference = oldUnsorted.length - limit
                for (let i = 0; i <= difference; i++) {
                    const popped = oldUnsorted.shift()
                    const remove = oldSorted.findIndex((element) => {
                        return element === popped
                    })
                    oldSorted.splice(remove, 1)
                }    
            }
            if (oldSorted.length) {
                updatedRolls = [...oldSorted]
                newNumbers.forEach(e => {
                    updatedRolls.unshift(e)
                    oldUnsorted.push(e)
                    updatedRolls = this.sortRolls(updatedRolls)
                })

                // Streak calculations
                const streak = RollTrackerData.getUserRolls(user.id)?.streak || []
                const currentRoll = oldUnsorted.at(-1)
                const prevRoll = oldUnsorted.at(-2)
                if (prevRoll-1 <= currentRoll && currentRoll <= prevRoll+1) {
                    if (!streak.length) streak.push(prevRoll)
                    streak.push(currentRoll)
                    game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.STREAK, streak)
                    if (streak.length >= 3) {
                        const streakString = streak.join(', ')
                        ChatMessage.create({ content: `<strong>${user.name} is on a streak!</strong> </br> ${streakString}`, speaker: {alias: 'Roll Tracker'} })
                    }
                } else {
                    game.users.get(user.id)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
                }
                
            } else {
                updatedRolls = newNumbers
                oldUnsorted = newNumbers
            }
            return Promise.all([
                game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.SORTED, updatedRolls),
                game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED, oldUnsorted)
            ])
        }
    }

    static clearTrackedRolls(userId) { 
    // Delete all stored rolls for a specified user ID
        return Promise.all([
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.SORTED), 
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT),
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED),
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
        ])
    }

    static sortRolls(rolls) {
    // Used to sort the rolls in ascending order for the purposes of median calculation
        return rolls.sort((a, b) => a - b)
    }

    static prepTrackedRolls(userId) { 
    // Package data for access via the FormApplication
        const username = this.getUserRolls(userId).user.name
        const thisUserId = this.getUserRolls(userId).user.id
        const printRolls = this.getUserRolls(userId).sorted

        let stats = {}

        if (!printRolls) {
            stats.mean = 0
            stats.median = 0
            stats.mode = [0],
            stats.comparator = 0,
            stats.nat1s = 0,
            stats.nat20s = 0
        } else {
            stats = this.calculate(printRolls)
        }
        return { username, thisUserId, stats }
    }

    static calculate(rolls) {
    // Turn the raw data array into usable stats:
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

        // We prepare the export data file at this point because the data is conveniently
        // ordered
        this.prepareExportData(modeObj)

        // the 'comparator' is the integer showing how many times the mode appears
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

    static prepareExportData(data) {
    // prepare the roll data for export to an R-friendly text file
        const keys = Object.keys(data)
        let fileContent = ``
        for (let key of keys) {
            fileContent += `${key},${data[key]}\n`
        }
        // We store the filecontent on a flag on the user so it can be quickly accessed if the user
        // decides to click the export button on the RollTrackerDialog header
        game.users.get(game.userId)?.setFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT, fileContent)
    }

    /** FUNCTIONAL BUT NOT YET IMPLEMENTED IN UI*/
    // This function is meant to generate an overall picture across all players of rankings in the
    // various stats.
    // In this format it has difficulty with 'ties' - rather than displaying all tied users it only
    // displays the last one processed
    static async generalComparison() {
        let allStats = {}
        for (let user of game.users) {
            if (game.users.get(user.id)?.getFlag(RollTracker.ID, RollTracker.FLAGS.SORTED)) {
                allStats[user.id] = this.prepTrackedRolls(user.id).stats
                // allStats[user.id].mode = [allStats[user.id].mode.at(0), allStats[user.id].mode.at(-1)]
            }
        }
        // highest/lowest of

            const means = await this.statsCompare(allStats, 'mean')

            const modes = await this.statsCompare(allStats, 'comparator')

            const medians = await this.statsCompare(allStats, 'median')

            const nat1s = await this.statsCompare(allStats, 'nat1s')

            const nat20s = await this.statsCompare(allStats, 'nat20s')

            const finalComparison = {
                highest: {
                    mean: {name: game.users.get(`${means.topmean}`)?.name, mean: allStats[`${means.topmean}`].mean},
                    median: {name: game.users.get(`${medians.topmedian}`)?.name, median: allStats[`${medians.topmedian}`].median},
                    mode: {name: game.users.get(`${modes.topcomparator}`)?.name, mode: allStats[`${modes.topcomparator}`].mode.join(', '), comparator: allStats[`${modes.topcomparator}`].comparator},
                    nat1s: {name: game.users.get(`${nat1s.topnat1s}`)?.name, nat1s: allStats[`${nat1s.topnat1s}`].nat1s},
                    nat20s: {name: game.users.get(`${nat20s.topnat20s}`)?.name, nat20s: allStats[`${nat20s.topnat20s}`].nat20s}
                },
                lowest: {
                    mean: {name: game.users.get(`${means.botmean}`)?.name, mean: allStats[`${means.botmean}`].mean},
                    median: {name: game.users.get(`${medians.botmedian}`)?.name, median: allStats[`${medians.botmedian}`].median},
                    mode: {name: game.users.get(`${modes.botcomparator}`)?.name, mode: allStats[`${modes.botcomparator}`].mode.join(', '), comparator: allStats[`${modes.botcomparator}`].comparator},
                    nat1s: {name: game.users.get(`${nat1s.botnat1s}`)?.name, nat1s: allStats[`${nat1s.botnat1s}`].nat1s},
                    nat20s: {name: game.users.get(`${nat20s.botnat20s}`)?.name, nat20s: allStats[`${nat20s.botnat20s}`].nat20s}
                }
            }
            RollTracker.log(false, finalComparison)
    }

    // A general function to compare incoming 'stats' using a specific data object in the format
    // generated in the allStats variable of generalComparison()
    static async statsCompare(obj, stat) {
        let topStat = -1;
        let comparison = {}
            for (let user in obj) {
                if (obj[`${user}`][stat] >= topStat) {
                    topStat = obj[`${user}`][stat]
                    const statKey = `top${stat}`
                    comparison[statKey] = user
                }
            }
            let botStat = 9999;
            for (let user in obj) {
                if (obj[`${user}`][stat] < botStat) {
                    botStat = obj[`${user}`][stat]
                    const statKey = `bot${stat}`
                    comparison[statKey] = user
                }
            }
        return comparison
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
        const rollData = RollTrackerData.prepTrackedRolls(this.object)
        // The lines below convert the mode array returned from prepTrackedRolls into a prettier 
        // string for display purposes. We choose to do the conversion to string here so that
        // prepTrackedRolls generates raw data which can be more easily read/compared/manipulated
        // as in generalComparison()
        const modeString = rollData.stats.mode.join(', ')
        rollData.stats.mode = modeString
        return rollData
    }

    activateListeners(html) {
        super.activateListeners(html);

        // With the below function, we are specifying that for the _handleButtonClick function, 
        // the keyword 'this' will refer to the current value of this as used in the bind function
        // i.e. RollTrackerDialog
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
            } case 'print': {
                const content = await renderTemplate(RollTracker.TEMPLATES.CHATMSG, RollTrackerData.prepTrackedRolls(this.object))
                ChatMessage.create( { content } )
            }
        }
    }

    get exportData() {
        return RollTrackerData.getUserRolls(game.userId)?.export
    }

    // This function gets the header data from FormApplication but modifies it to add our export button
    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons.splice(0, 0, {
            class: "roll-tracker-form-export",
            icon: "fas fa-download",
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