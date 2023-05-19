/** TODO: 
 * SETTINGS - CAN PLAYERS CLEAR THEIR OWN ROLLS? TREAT FORTUNE/MISFORTUNE AS ONLY THE ROLL TAKEN OR BOTH ROLLED?
 * * HAVE CHECKBOXES FOR WHAT KIND OF ROLLS ARE CONSIDERED - VERY SYSTEM SPECIFIC
 * SIZE OF DICE TO BE TRACKED
 * NEW FEATURES - One click clear everyone's rolls
 *              - Session logs - collect all the rolls for a given log in session and store it. Access past session logs, maybe you can combine them. 
 */

/** QUESTIONS:
 * I DON'T UNDERSTAND HOW ROLLTRACKERHELPER.WAITFOR3DDICEMESSAGE ACTUALLY WORKS - WHAT DOES RESOLVE(TRUE) MEAN? DOESN'T IT BECOME
 * AN ENDLESS LOOP IF THE 'ELSE' OF THE FIRST CONDITIONAL JUST RUNS THE FUNCTION AGAIN?
 */

// Whenever a chat message is created, check if it contains a roll. If so, parse it to determine
// whether it should be tracked, according to our module settings
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
            // Put the roll tracker icon only beside the GM's name
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
            new RollTrackerDialog(game.userId).render(true);
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

// We're using sockets to ensure the streak message is always transmitted by the GM.
// This allows us to completely hide it from players if a part of the streak was blind, or if
// the Hide All Streak Messages setting is enabled
Hooks.once('ready', () => {
    game.socket.on("module.roll-tracker", (data) => {
        if (game.user.isGM) {
            ChatMessage.create(data)
        }
    }) 
})

// The following helper functions help us to make and display the right strings for chat cards and the comparison card
// Mostly they're checking for multiple modes, or ties in the case of the comparison card
Handlebars.registerHelper('isOne', function (value) {
    return value === 1;
});

Handlebars.registerHelper('isTwo', function (value) {
    return value === 2;
});

Handlebars.registerHelper('isThreePlus', function (value) {
    return value > 2;
});

// If the length of the input array is more than one, there is a tie (whether in mode or for a given statistic like highest mean)
Handlebars.registerHelper('isTie', function (value) {
    return value.length > 1;
});

// To check if the current item being iterated over is the last item in the array
Handlebars.registerHelper('isLast', function (index, length) {
    if (length - index === 1) return true
});

// To check if the current item being iterated over is the second last item in the array
Handlebars.registerHelper('isSecondLast', function (index, length) {
    if (length - index === 2) return true
});


// Store basic module info
class RollTracker { 
    static ID = 'roll-tracker'

    static FLAGS = {
        SORTED: 'sorted',
        EXPORT: 'export',
        UNSORTED: 'unsorted',
        STREAK: 'streak',
    }

    static TEMPLATES = {
        ROLLTRACK: `modules/${this.ID}/templates/${this.ID}.hbs`,
        CHATMSG: `modules/${this.ID}/templates/${this.ID}-chat.hbs`,
        COMPARISONCARD: `modules/${this.ID}/templates/${this.ID}-comparison-card.hbs`
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
        STREAK_MESSAGE_HIDDEN: 'streak_message_hidden',
        STREAK_BEHAVIOUR: 'streak_behaviour',
        STREAK_THRESHOLD: 'streak_threshold',
        DND5E: {
            RESTRICT_COUNTED_ROLLS: 'restrict_counted_rolls'
        },
        PF2E: {
            RESTRICT_COUNTED_ROLLS: 'restrict_counted_rolls'
        }
    }

    static initialize() {
        // Store the current system, for settings purposes. It has to be set here, and not in the parent
        // class, because the system needs to initialize on foundry boot up before we can get its id
        this.SYSTEM = `${game.system.id}`

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

        // A setting to determine whether blind GM rolls that PLAYERS make are tracked
        // Blind GM rolls that GMs make are always tracked
        game.settings.register(this.ID, this.SETTINGS.COUNT_HIDDEN, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Hint`,
        })

        // Are streaks completely disabled, are they shown only to GMs, or are they shown to everyone
        game.settings.register(this.ID, this.SETTINGS.STREAK_BEHAVIOUR, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_BEHAVIOUR}.Name`,
            default: true,
            type: String,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_BEHAVIOUR}.Hint`,
            choices: {
                hidden: game.i18n.localize(`ROLL-TRACKER.settings.${this.SETTINGS.STREAK_BEHAVIOUR}.hidden`),
                disable: game.i18n.localize(`ROLL-TRACKER.settings.${this.SETTINGS.STREAK_BEHAVIOUR}.disable`),
                shown: game.i18n.localize(`ROLL-TRACKER.settings.${this.SETTINGS.STREAK_BEHAVIOUR}.shown`)
            }
        })

        // What is the threshold of consecutive rolls within 1 point of each other that should be considered
        // a streak?
        game.settings.register(this.ID, this.SETTINGS.STREAK_THRESHOLD, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_THRESHOLD}.Name`,
            default: true,
            type: Number,
            range: {
                min: 2,
                max: 5,
                step: 1
            },
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_THRESHOLD}.Hint`
        })

        // System specific settings
        switch(this.SYSTEM) {
            case 'dnd5e':
                // A setting to specify that only rolls connected to an actor will be counted, not just
                // random '/r 1d20s' or the like
                game.settings.register(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS, {
                    name: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Name`,
                    default: true,
                    type: Boolean,
                    scope: 'world',
                    config: true,
                    hint: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Hint`,
                })
                break;
            case 'pf2e':
                // A setting to specify that only rolls connected to an actor will be counted, not just
                // random '/r 1d20s' or the like
                game.settings.register(this.ID, this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS, {
                    name: `ROLL-TRACKER.settings.pf2e.${this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS}.Name`,
                    default: true,
                    type: Boolean,
                    scope: 'world',
                    config: true,
                    hint: `ROLL-TRACKER.settings.pf2e.${this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS}.Hint`,
                })
                break;
        }   
    }

    // This function creates an object containing all the requirements that need to be met for the roll
    // to be counted, taking into account all the currently active settings. If all of the conditions are
    // met, the roll is recorded.
    static async parseMessage(chatMessage, system) {
        const isBlind = chatMessage.blind
        const rollRequirements = {
            isd20: chatMessage.rolls[0]?.dice[0]?.faces === 20,
            blindCheck: (!isBlind) || (isBlind && game.settings.get(this.ID, this.SETTINGS.COUNT_HIDDEN)) || (isBlind && chatMessage.rolls[0]?.roller.isGM),
        }
        switch (system) {
            case 'dnd5e':
                if (game.settings.get(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS)) {
                    if (chatMessage.flags.dnd5e?.roll?.type) {
                        rollRequirements.dnd5e_restrict_passed = true
                    } else {
                        rollRequirements.dnd5e_restrict_passed = false
                    }
                }
                break;
            case 'pf2e':
                if (game.settings.get(this.ID, this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS)) {
                    if (chatMessage.flags.pf2e?.context?.type) {
                        rollRequirements.pf2e_restrict_passed = true
                    } else {
                        rollRequirements.pf2e_restrict_passed = false
                    }
                }
                break;
        }
        const checksPassed = Object.values(rollRequirements).every(check => {
            return check === true
        })            
        if (chatMessage.isContentVisible) await RollTrackerHelper.waitFor3DDiceMessage(chatMessage.id)
        if (checksPassed) {
            RollTrackerData.createTrackedRoll(chatMessage.user, chatMessage.rolls[0], isBlind)
        }
    }
}

class RollTrackerHelper {
// Functions that don't specifically manipulate data but are referenced or used
    // If Dice So Nice is enabled, this will help us wait until after the animation is shown
    // to send chat messages such as the Streak chat message, so we don't ruin the surprise of
    // the roll
    static async waitFor3DDiceMessage(targetMessageId) {
        function buildHook(resolve) {
          Hooks.once('diceSoNiceRollComplete', (messageId) => {
            if (targetMessageId === messageId)
              resolve(true);
            else
              buildHook(resolve)
          });
        }
        return new Promise((resolve, reject) => {
          if(game.dice3d){
            buildHook(resolve);
          } else {
            resolve(true);
          }
        });
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
            streak: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.STREAK),
        } 
        return output
    }

    static createTrackedRoll(user, rollData, isBlind) {
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
                let streak = {}

                // If there was an ongoing streak, pull those numbers for comparison
                streak.numbers = RollTrackerData.getUserRolls(user.id)?.streak?.numbers || []

                // If the last roll made was a blind roll, the potential streak currently
                // under examination includes a blind roll
                streak.includesBlind = RollTrackerData.getUserRolls(user.id)?.streak?.includesBlind || isBlind

                const currentRoll = oldUnsorted.at(-1)
                const prevRoll = oldUnsorted.at(-2)
                if (prevRoll-1 <= currentRoll && currentRoll <= prevRoll+1) {
                    if (!streak.numbers.length) streak.numbers.push(prevRoll)
                    streak.numbers.push(currentRoll)
                    const streakThreshold = game.settings.get(RollTracker.ID, RollTracker.SETTINGS.STREAK_THRESHOLD)
                    if (streak.numbers.length >= streakThreshold) {
                        const streakString = streak.numbers.join(', ')
                        let chatOpts = {
                            content: `<strong>${user.name} is on a streak!</strong> </br> ${streakString}`, speaker: {alias: 'Roll Tracker'}
                        }

                        // Follow the game setting concerning the visibility of streak messages
                        //
                        // If the current roll is blind, or the last roll was blind, the streak message (if generated)
                        // is only whispered to the GM, as it may reveal earlier blind rolls
                        const streakStatus = game.settings.get(RollTracker.ID, RollTracker.SETTINGS.STREAK_BEHAVIOUR)
                        if (streakStatus !== 'disable') {
                            if (streak.includesBlind || streakStatus === `hidden`) {
                                const gms = game.users.filter(user => user.isGM === true)
                                chatOpts.whisper = gms.map(gm => gm.id)
                            }
                            if (!game.user.isGM) {
                                game.socket.emit("module.roll-tracker", chatOpts)
                            } else {
                                ChatMessage.create(chatOpts)
                            }
                        }
                    }
                } else {
                    // If the last rolled number is not within 1 of the current rolled number, discard
                    // the streak
                    streak.numbers = []

                    // If there is no current streak but the current current roll is blind, a potential future
                    // streak includes a blind number.
                    // However if there is no current streak and the current roll is NOT blind, reset the
                    // variable tracking the presence of a blind roll in the streak
                    if (isBlind) {
                        streak.includesBlind = true
                    } else {
                        streak.includesBlind = false
                    }
                }
                game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.STREAK, streak)
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
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.STREAK),
        ])
    }

    static sortRolls(rolls) {
    // Used to sort the rolls in ascending order for the purposes of median calculation
        return rolls.sort((a, b) => a - b)
    }

    static async prepTrackedRolls(userId) { 
    // Package data for access via the FormApplication

        const username = this.getUserRolls(userId).user.name
        const thisUserId = this.getUserRolls(userId).user.id
        const printRolls = this.getUserRolls(userId).sorted

        let stats = {}

        if (!printRolls) {
            stats.mean = 0,
            stats.median = 0,
            stats.mode = [0],
            stats.comparator = 0,
            stats.nat1s = 0,
            stats.nat1sPercentage = 0,
            stats.nat20s = 0,
            stats.nat20sPercentage = 0,
            stats.count = 0
        } else {
            stats = await this.calculate(printRolls)
            // For debugging purposes primarily:
            // stats.lastRoll = this.getUserRolls(userId)?.unsorted.at(-1)
        }
        
        return { username, thisUserId, stats 
            /**, averages */ }
    }

    static async calculate(rolls) {
    // Turn the raw data array into usable stats:
    // Mean
        const sum = rolls.reduce((firstValue, secondValue) => {
            return firstValue + secondValue
        })
        const mean = Math.round(sum / rolls.length)

    // Median
        // We've already sorted the rolls as they've come in
        let median = 0

        // If there are an odd number of rolls, the median is the centermost number
        if (rolls.length % 2 === 1) {
            let medianPosition = Math.floor(rolls.length / 2)
            median = rolls[medianPosition]
        // If there are an even number of rolls, the median is the average of the two
        // centermost numbers
        } else {
            let beforeMedian = (rolls.length / 2)
            let afterMedian = beforeMedian + 1
            // Subtracting one from each as we transition from length -> index
            // There's a shorter way of doing this but this makes the most sense to me for later
            median = (rolls[beforeMedian-1] + rolls[afterMedian-1]) / 2
        }
         

    // Mode
        const res = await this.calcMode(rolls)
        const modeObj = res.modeObj
        const mode = res.mode
        const comparator = res.comparator

    // We prepare the export data file at this point because the data is conveniently
    // ordered in modeObj
        this.prepareExportData(modeObj)

    // How many Nat1s or Nat20s do we have? Convert into % as well.
        const nat1s = modeObj[1] || 0
        const nat1sPercentage = (Math.round((nat1s / rolls.length) * 100))
        const nat20s = modeObj[20] || 0        
        const nat20sPercentage = (Math.round((nat20s / rolls.length) * 100))

    // How many rolls are being counted?
        const count = rolls.length

        return {
            mean,
            median,
            mode,
            comparator,
            nat1s,
            nat1sPercentage,
            nat20s,
            nat20sPercentage,
            count
        }
    }

    static async calcMode(rolls) {
        // Mode
        let modeObj = {}
        rolls.forEach(e => {
            if (!modeObj[e]) {
                modeObj[e] = 1
            } else {
                modeObj[e]++
            }
        })

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

        return { modeObj, mode, comparator }
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

    /**
     *  COMPARATOR
     * This function is meant to generate an overall picture across all players of rankings in the
     * various stats. Code exists to make the averages display alongside the individual player numbers
     * in the tracking card but I didn't like that
     * **/
    

    static async generalComparison() {
        let allStats = {}
        for (let user of game.users) {
            if (game.users.get(user.id)?.getFlag(RollTracker.ID, RollTracker.FLAGS.SORTED)) {
                const rolls = this.getUserRolls(user.id)?.sorted
                allStats[`${user.id}`] = await this.calculate(rolls)
            }
        }
        // highest/lowest of

            const comparators = await this.statsCompare(allStats, 'comparator')
            const means = await this.statsCompare(allStats, 'mean')
            const medians = await this.statsCompare(allStats, 'median')
            const nat1s = await this.statsCompare(allStats, 'nat1s')
            const nat1sPercentage = await this.statsCompare(allStats, 'nat1sPercentage')
            const nat20s = await this.statsCompare(allStats, 'nat20s')
            const nat20sPercentage = await this.statsCompare(allStats, 'nat20sPercentage')
            let finalComparison = {}
            this.prepStats(finalComparison, 'mean', means, allStats)
            this.prepStats(finalComparison, 'median', medians, allStats)
            this.prepStats(finalComparison, 'nat1s', nat1s, allStats)
            this.prepStats(finalComparison, 'nat1sPercentage', nat1sPercentage, allStats)
            this.prepStats(finalComparison, 'nat20s', nat20s, allStats)
            this.prepStats(finalComparison, 'nat20sPercentage', nat20sPercentage, allStats)
            this.prepMode(finalComparison, 'comparator', comparators, allStats)

            return finalComparison
    } 


    // A general function to compare incoming 'stats' using a specific data object in the format
    // generated in the allStats variable of generalComparison()

    static async statsCompare(allStats, stat) {
        let topStat = -1;
        let comparison = {}
            for (let user in allStats) {
                if (allStats[`${user}`][stat] > topStat) {
                    topStat = allStats[`${user}`][stat]
                    comparison.top = [user]
                } else if (allStats[`${user}`][stat] === topStat) {
                    comparison.top.push(user)
                }
            }

        if (stat !== 'comparator') {
            let botStat = 9999;
                for (let user in allStats) {
                    if (allStats[`${user}`][stat] < botStat) {
                        botStat = allStats[`${user}`][stat]
                        comparison.bot = [user]
                    } else if (allStats[`${user}`][stat] === botStat) {
                        comparison.bot.push(user)
                    }
                }

            let statSum = 0
            for (let user in allStats) {
                statSum += allStats[`${user}`][stat]
            }
            comparison.average = Math.round(statSum / (Object.keys(allStats).length))
        } else {
            topStat = -1;
                for (let user in allStats) {
                    let percentage = Math.round(((allStats[`${user}`][stat]) / (allStats[`${user}`].count)) * 100)
                    if (percentage > topStat) {
                        topStat = percentage
                        comparison.topPercentage = [user]
                    } else if (percentage === topStat) {
                        comparison.topPercentage.push(user)
                    }
                }
        }
        
        return comparison
    }

    // A function preparing the output object of generalComparison (the obj is called finalComparison)
    // using previously calculated stats

    static async prepStats(finalComparison, statName, statObj, allStats) {

        finalComparison[statName] = {}
            finalComparison[statName].highest = []
            finalComparison[statName].lowest = []

            for (let user of statObj.top) {
                const userStats = {}
                userStats.userId = `${user}`
                userStats.name = game.users.get(`${user}`)?.name
                userStats.value = allStats[`${user}`][statName]
                userStats.rolls = allStats[`${user}`].count
                finalComparison[statName].highest.push(userStats)
            }

            for (let user of statObj.bot) {
                const userStats = {}
                userStats.userId = `${user}`
                userStats.name = game.users.get(`${user}`)?.name
                userStats.value = allStats[`${user}`][statName]
                userStats.rolls = allStats[`${user}`].count
                finalComparison[statName].lowest.push(userStats)
            }

            finalComparison[statName].average = statObj.average
    }

    // Mode has its own way to be prepped as it can be multimodal etc
    static async prepMode(finalComparison, comparator, comparators, allStats) {
        finalComparison[comparator] = {}
            finalComparison[comparator].highest = {}
            for (let user of comparators.top) {
                finalComparison[comparator].highest.userId = `${user}`
                finalComparison[comparator].highest.name = game.users.get(`${user}`)?.name
                const mode = allStats[`${user}`].mode
                let modeString = mode.join(', ')
                if (mode.length > 1) {
                    const orPosn = modeString.lastIndexOf(',')
                    const firstHalf = modeString.slice(0, orPosn)
                    const secondHalf = modeString.slice(orPosn+1)
                    modeString = firstHalf.concat(' or', secondHalf)
                }
                finalComparison[comparator].highest.mode = modeString
                finalComparison[comparator].highest.value = allStats[`${user}`][comparator]
                finalComparison[comparator].highest.rolls = allStats[`${user}`].count
                finalComparison[comparator].highest.percentage = Math.round((((finalComparison[comparator].highest.value) / (finalComparison[comparator].highest.rolls))) * 100)
            }
            finalComparison[comparator].highestPercentage = {}
            for (let user of comparators.topPercentage) {
                finalComparison[comparator].highestPercentage.userId = `${user}`
                finalComparison[comparator].highestPercentage.name = game.users.get(`${user}`)?.name
                const mode = allStats[`${user}`].mode
                let modeString = mode.join(', ')
                if (mode.length > 1) {
                    const orPosn = modeString.lastIndexOf(',')
                    const firstHalf = modeString.slice(0, orPosn)
                    const secondHalf = modeString.slice(orPosn+1)
                    modeString = firstHalf.concat(', or', secondHalf)
                }
                finalComparison[comparator].highestPercentage.mode = modeString
                finalComparison[comparator].highestPercentage.value = allStats[`${user}`][comparator]
                finalComparison[comparator].highestPercentage.rolls = allStats[`${user}`].count
                finalComparison[comparator].highestPercentage.percentage = Math.round((((finalComparison[comparator].highestPercentage.value) / (finalComparison[comparator].highestPercentage.rolls))) * 100)
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

    async getData() {
        const rollData = await RollTrackerData.prepTrackedRolls(this.object)

        // The lines below convert the mode array returned from prepTrackedRolls into a prettier 
        // string for display purposes. We choose to do the conversion to string here so that the
        // prepTrackedRolls func can continue to generate raw data which can be more easily 
        // read/compared/manipulated, as in generalComparison()
        
        const modeString = rollData.stats.mode.join(', ')
        // const modeString_averages = rollData.averages.mode.join(', ')
        rollData.stats.mode = modeString
        // rollData.averages.mode = modeString_averages

        return rollData
    }

    async prepCompCard() {
        let comparison = await RollTrackerData.generalComparison()
        let content = await renderTemplate(RollTracker.TEMPLATES.COMPARISONCARD, comparison)
        ChatMessage.create( { content } )
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
                const rollData = await RollTrackerData.prepTrackedRolls(this.object)
                const modeString = rollData.stats.mode.join(', ')
                rollData.stats.mode = modeString

                const content = await renderTemplate(RollTracker.TEMPLATES.CHATMSG, rollData)
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
        if (game.user.isGM) {
            buttons.splice(1, 0, {
                class: "roll-tracker-form-comparison",
                icon: "fas fa-chart-simple",
                onclick: ev => {
                    this.prepCompCard()
                }
            })
        }
        return buttons
    }

}