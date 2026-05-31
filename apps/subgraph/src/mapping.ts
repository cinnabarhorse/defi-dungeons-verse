import {
  Deposited,
  GameTreasuryUpdated,
  InterestHarvested,
  StableConfigured,
  TreasuryUpdated,
  Withdrawn,
} from '../generated/Contract/Contract';
import {
  Deposit,
  User,
  Harvest,
  TreasuryUpdate,
  GameTreasuryUpdate,
  StableConfig,
  Withdrawal,
} from '../generated/schema';

export function handleDeposited(event: Deposited): void {
  let user = User.load(event.params.user.toHexString());
  if (!user) {
    user = new User(event.params.user.toHexString());
    user.save();
  }

  let id = event.params.user
    .toHexString()
    .concat('-')
    .concat(event.params.depositId.toString());
  let deposit = new Deposit(id);
  deposit.depositId = event.params.depositId;
  deposit.user = user.id;
  deposit.token = event.params.depositToken;
  deposit.amount = event.params.depositAmount;
  deposit.yieldAmount = event.params.yieldAmount;
  deposit.pointsMinted = event.params.pointsMinted;
  deposit.unlockAt = event.params.unlockAt;
  deposit.withdrawn = false;
  deposit.timestamp = event.block.timestamp;
  deposit.txHash = event.transaction.hash;
  deposit.save();
}

export function handleWithdrawn(event: Withdrawn): void {
  let id = event.params.user
    .toHexString()
    .concat('-')
    .concat(event.params.depositId.toString());
  let deposit = Deposit.load(id);
  if (deposit) {
    deposit.withdrawn = true;
    deposit.withdrawalTx = event.transaction.hash;
    deposit.save();

    let withdrawal = new Withdrawal(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(event.logIndex.toString())
    );
    withdrawal.user = event.params.user.toHexString();
    withdrawal.deposit = deposit.id;
    withdrawal.token = event.params.token;
    withdrawal.amount = event.params.amount;
    withdrawal.timestamp = event.block.timestamp;
    withdrawal.txHash = event.transaction.hash;
    withdrawal.save();
  }
}

export function handleInterestHarvested(event: InterestHarvested): void {
  let harvest = new Harvest(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(event.logIndex.toString())
  );
  harvest.totalAmount = event.params.totalAmount;
  harvest.treasuryPortion = event.params.treasuryPortion;
  harvest.gameTreasuryPortion = event.params.gameTreasuryPortion;
  harvest.timestamp = event.block.timestamp;
  harvest.txHash = event.transaction.hash;
  harvest.save();
}

export function handleStableConfigured(event: StableConfigured): void {
  let config = new StableConfig(event.params.yieldToken.toHexString());
  config.yieldTokenDecimals = event.params.yieldTokenDecimals;
  config.yieldAToken = event.params.yieldAToken;
  config.timestamp = event.block.timestamp;
  config.txHash = event.transaction.hash;
  config.save();
}

export function handleTreasuryUpdated(event: TreasuryUpdated): void {
  let update = new TreasuryUpdate(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(event.logIndex.toString())
  );
  update.newTreasury = event.params.treasury;
  update.timestamp = event.block.timestamp;
  update.txHash = event.transaction.hash;
  update.save();
}

export function handleGameTreasuryUpdated(event: GameTreasuryUpdated): void {
  let update = new GameTreasuryUpdate(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(event.logIndex.toString())
  );
  update.newGameTreasury = event.params.gameTreasury;
  update.timestamp = event.block.timestamp;
  update.txHash = event.transaction.hash;
  update.save();
}
