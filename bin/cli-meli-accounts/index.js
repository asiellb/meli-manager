#!/usr/bin/env node
const envPath = require('path').resolve(__dirname, '.env')
require('dotenv').config({path: envPath})
const chalk = require('chalk')
const program = require('commander')

program
  .version('0.1.0')
  .description('Interactive CLI for MercadoLibre user Accounts management.')
  .option('-u, --user <nickname>', 'Run using specified nickname Account keys for MeLi API requests.')
  .parse(process.argv)

if (!program.user) {
  console.error(chalk.yellow(`Please specify ${chalk.bold('-u|--user <nickname>')} option.`))
  program.outputHelp()
  process.exit()
}

const devAccountNickname = program.user
let clientOwnerData = null

const db = require('../../config/db')
const Account = require('../../model/account')
const prompt = require('./prompt')

const cliLoginFlow = require('./cli-login-flow')
const createMeliTestAccount = require('./create-meli-test-account')
const getOwnerAccount = require('./get-owner-account')

async function doLoginFlow() {
  let accountTokens
  try {
    accountTokens = await cliLoginFlow.run()
  } catch (error) {
    throw new Error(`Could not complete authentication. Reason: ${error.message || error}`)
  }
  console.log('Logged in!')
  return accountTokens
}

async function generateTestAccount() {
  let testAccount
  try {
    testAccount = await createMeliTestAccount(devAccountNickname)
  } catch (error) {
    // TODO if error is lack of dev account, retry? suggest a different client id?
    throw new Error(`Whoops, could not create a test account: ${error.message || error.data || error}`)
  }
  console.log('Test account is: ', testAccount)
}

async function registerAccount({profile, tokens}) {
  let account
  try {
    account = await Account.register(profile, tokens)
  } catch (error) {
    throw new Error('Problem registering account: ' + (error.message || error))
  }
  const verbMsg = account.isNewAccount() ? 'Registered new' : 'Updated existing'
  console.log(chalk.green(`${verbMsg} ${account.isTestAccount ? 'test' : ''}account '${chalk.bold.green(account.nickname)}' succesfully.`))
}

const options = {
  newTestAccount: async () => {
    console.log('Creating test account...')
    try {
      await generateTestAccount()
      const loggedUser = await doLoginFlow()
      await registerAccount(loggedUser)
    } catch (error) {
      console.error(chalk.red(error.message || error))
    }
  },
  existingAccount: async () => {
    console.log('Please log in with an existing account.')
    try {
      const loggedUser = await doLoginFlow()
      await registerAccount(loggedUser)
    } catch (error) {
      console.error(chalk.red(error.message || error))
    }
  },
  exit: () => {
    console.log(chalk.bold.green('Bye!'))
  }
}

/**
 * Find the current clientOwner user data and store it locally.
 *
 * This is needed to properly create and maintain test accounts,
 * and useful to register and refresh regular accounts as well.
 *
 * @returns {Promise<void>} - exec promise
 */
async function retrieveClientOwnerData() {
  let ownerAccount
  try {
    ownerAccount = await getOwnerAccount()
  } catch (error) {
    const errMsgReason = error.message || error.data || error
    console.error(chalk.yellow('Could not retrieve client owner account data. ' +
      `${errMsgReason ? chalk.yellow.bold(`Reason: ${errMsgReason}`) : ''} ` +
      'Please log in with any account and try again.'))
    const {profile, tokens} = await cliLoginFlow.run()
    await registerAccount({profile, tokens})
    ownerAccount = await getOwnerAccount()
  }

  // Response: set to clientOwnerData
  clientOwnerData = ownerAccount.clientOwnerData
}

/**
 * Initialize needed services.
 *
 * @returns {Promise<void>} - exec promise
 */
async function setup() {
  await db.connect()
  await cliLoginFlow.setup()
  await retrieveClientOwnerData()
}

/**
 * Cleanup/close opened services for a graceful process exit.
 * Otherwise the process will keep running.
 *
 * @returns {Promise<void>} - exec promise
 */
async function exit() {
  await cliLoginFlow.clean()
  await db.disconnect()
}

async function main() {
  console.log(chalk.cyan('Welcome!'))
  await setup()
  const isFirstLogin = !clientOwnerData && !(await Account.findAnyAuthorized())

  let choice
  do {
    const isDbConnected = await db.isConnected()
    choice = await prompt({isDbConnected, isFirstLogin})
    const selectedAction = options[choice.action]
    if (!selectedAction) {
      console.error(chalk.bold.red(`Selected option is not valid: ${chalk.red(JSON.stringify(choice))}`))
      continue
    }
    await selectedAction()
  } while (choice.action !== 'exit')

  await exit()
}

(async () => {
  try {
    await main()
  } catch (error) {
    console.error(chalk.bold.red('unexpected error: '), error)
    process.exit(1)
  }
})()
