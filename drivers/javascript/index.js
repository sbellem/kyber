import { Buffer } from 'buffer';

import base58 from 'bs58';
import clone from 'clone';
import cc from 'five-bells-condition';
import nacl from 'tweetnacl';
import sha3 from 'js-sha3';
import stableStringify from 'json-stable-stringify';

/**
 * @class Keypair Ed25519 keypair in base58 (as BigchainDB expects base58 keys)
 * @type {Object}
 * @property {string} publicKey
 * @property {string} privateKey
 */
export function Ed25519Keypair() {
    const keyPair = nacl.sign.keyPair();
    this.publicKey = base58.encode(keyPair.publicKey);

    // tweetnacl's generated secret key is the secret key + public key (resulting in a 64-byte buffer)
    this.privateKey = base58.encode(keyPair.secretKey.slice(0, 32));
}

/**
 * Create an Ed25519 Cryptocondition from an Ed25519 public key to put into an Output of a Transaction
 * @param {string} publicKey base58 encoded Ed25519 public key for the recipient of the Transaction
 * @returns {object} Ed25519 Condition (that will need to wrapped in an Output)
 */
export function makeEd25519Condition(publicKey) {
    const publicKeyBuffer = new Buffer(base58.decode(publicKey));

    const ed25519Fulfillment = new cc.Ed25519();
    ed25519Fulfillment.setPublicKey(publicKeyBuffer);
    const conditionUri = ed25519Fulfillment.getConditionUri();

    return {
        'details': {
            'signature': null,
            'type_id': 4,
            'type': 'fulfillment',
            'bitmask': 32,
            'public_key': publicKey,
        },
        'uri': conditionUri,
    };
}

/**
 * Create an Output from a Condition.
 * Note: Assumes the given Condition was generated from a single public key (e.g. a Ed25519 Condition)
 * @param {object} condition Condition (e.g. a Ed25519 Condition from `makeEd25519Condition()`)
 * @param {number} amount Amount of the output
 * @returns {object} An Output usable in a Transaction
 */
export function makeOutput(condition, amount = 1) {
    return {
        amount,
        condition,
        'public_keys': [condition.details.public_key],
    };
}

/**
 * Generate a `CREATE` transaction holding the `asset`, `metadata`, and `outputs`, to be signed by
 * the `issuers`.
 * @param {object} asset Created asset's data
 * @param {object} metadata Metadata for the Transaction
 * @param {object[]} outputs Array of Output objects to add to the Transaction.
 *                           Think of these as the recipients of the asset after the transaction.
 *                           For `CREATE` Transactions, this should usually just be a list of
 *                           Outputs wrapping Ed25519 Conditions generated from the issuers' public
 *                           keys (so that the issuers are the recipients of the created asset).
 * @param {...string[]} issuers Public key of one or more issuers to the asset being created by this
 *                              Transaction.
 *                              Note: Each of the private keys corresponding to the given public
 *                              keys MUST be used later (and in the same order) when signing the
 *                              Transaction (`signTransaction()`).
 * @returns {object} Unsigned transaction -- make sure to call signTransaction() on it before
 *                   sending it off!
 */
export function makeCreateTransaction(asset, metadata, outputs, ...issuers) {
    const assetDefinition = {
        'data': asset || null,
    };
    const inputs = issuers.map((issuer) => makeInputTemplate([issuer]));

    return makeTransaction('CREATE', assetDefinition, metadata, outputs, inputs);
}

/**
 * Generate a `TRANSFER` transaction holding the `asset`, `metadata`, and `outputs`, that fulfills
 * the `fulfilledOutputs` of `unspentTransaction`.
 * @param {object} unspentTransaction Previous Transaction you have control over (i.e. can fulfill
 *                                    its Output Condition)
 * @param {object} metadata Metadata for the Transaction
 * @param {object[]} outputs Array of Output objects to add to the Transaction.
 *                           Think of these as the recipients of the asset after the transaction.
 *                           For `TRANSFER` Transactions, this should usually just be a list of
 *                           Outputs wrapping Ed25519 Conditions generated from the public keys of
 *                           the recipients.
 * @param {...number} fulfilledOutputs Indices of the Outputs in `unspentTransaction` that this
 *                                     Transaction fulfills.
 *                                     Note that the public keys listed in the fulfilled Outputs
 *                                     must be used (and in the same order) to sign the Transaction
 *                                     (`signTransaction()`).
 * @returns {object} Unsigned transaction -- make sure to call signTransaction() on it before
 *                   sending it off!
 */
export function makeTransferTransaction(unspentTransaction, metadata, outputs, ...fulfilledOutputs) {
    const inputs = fulfilledOutputs.map((outputIndex) => {
        const fulfilledOutput = unspentTransaction.outputs[outputIndex];
        const transactionLink = {
            'output': outputIndex,
            'txid': unspentTransaction.id,
        };

        return makeInputTemplate(fulfilledOutput.public_keys, transactionLink);
    });

    const assetLink = {
        'id': unspentTransaction.operation === 'CREATE' ? unspentTransaction.id
                                                        : unspentTransaction.asset.id
    };

    return makeTransaction('TRANSFER', assetLink, metadata, outputs, inputs);
}

/**
 * Sign the given `transaction` with the given `privateKey`s, returning a new copy of `transaction`
 * that's been signed.
 * Note: Only generates Ed25519 Fulfillments. Thresholds and other types of Fulfillments are left as
 * an exercise for the user.
 * @param {object} transaction Transaction to sign. `transaction` is not modified.
 * @param {...string} privateKeys Private keys associated with the issuers of the `transaction`.
 *                                Looped through to iteratively sign any Input Fulfillments found in
 *                                the `transaction`.
 * @returns {object} The signed version of `transaction`.
 */
export function signTransaction(transaction, ...privateKeys) {
    const signedTx = clone(transaction);
    signedTx.inputs.forEach((input, index) => {
        const privateKey = privateKeys[index];
        const privateKeyBuffer = new Buffer(base58.decode(privateKey));
        const serializedTransaction = serializeTransactionIntoCanonicalString(transaction);

        const ed25519Fulfillment = new cc.Ed25519();
        ed25519Fulfillment.sign(new Buffer(serializedTransaction), privateKeyBuffer);
        const fulfillmentUri = ed25519Fulfillment.serializeUri();

        input.fulfillment = fulfillmentUri;
    });

    return signedTx;
}

/*********************
 * Transaction utils *
 *********************/

function makeTransactionTemplate() {
    return {
        'id': null,
        'operation': null,
        'outputs': [],
        'inputs': [],
        'metadata': null,
        'asset': null,
        'version': '0.9',
    };
}

function makeInputTemplate(publicKeys = [], fulfills = null, fulfillment = null) {
    return {
        fulfillment,
        fulfills,
        'owners_before': publicKeys,
    };
}

function makeTransaction(operation, asset, metadata = null, outputs = [], inputs = []) {
    const tx = makeTransactionTemplate();
    tx.operation = operation;
    tx.asset = asset;
    tx.metadata = metadata;
    tx.inputs = inputs;
    tx.outputs = outputs;

    // Hashing must be done after, as the hash is of the Transaction (up to now)
    tx.id = hashTransaction(tx);
    return tx;
}

/****************
 * Crypto utils *
 ****************/

function hashTransaction(transaction) {
    // Safely remove any tx id from the given transaction for hashing
    const tx = { ...transaction };
    delete tx.id;

    return sha256Hash(serializeTransactionIntoCanonicalString(tx));
}

function sha256Hash(data) {
    return sha3.sha3_256
        .create()
        .update(data)
        .hex();
}

function serializeTransactionIntoCanonicalString(transaction) {
    // BigchainDB signs fulfillments by serializing transactions into a "canonical" format where
    // each fulfillment URI is removed before sorting the remaining keys
    const tx = clone(transaction);
    tx.inputs.forEach((input) => {
        input.fulfillment = null;
    });

    // Sort the keys
    return stableStringify(tx, (a, b) => (a.key > b.key ? 1 : -1));
}
