import { log, Address, BigDecimal, BigInt, EthereumEvent } from "@graphprotocol/graph-ts"
import { Badge, BadgeClaim, BadgeClaimPeriod, Token, BadgeStateManager, TokenDayData } from '../types/schema'

export const ADDRESS_UNIP_ETH_USDC = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
export const ADDRESS_UNIP_ETH_USDT = '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852'
export const ADDRESS_UNIP_ETH_DAI = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11'
export const ADDRESS_WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

export function shouldHandlePair(address: string): boolean {
  var pairIsSupported = false

  if (address == ADDRESS_UNIP_ETH_DAI || address == ADDRESS_UNIP_ETH_USDC || address == ADDRESS_UNIP_ETH_USDT) {
    pairIsSupported = true
  }

  return pairIsSupported
}

export function sharedBadgeStateManager(): BadgeStateManager {
  let sm = BadgeStateManager.load("1")
  if (sm === null) {
    sm = new BadgeStateManager("1")
    sm.lastBadgeUpdateTimestamp = BigInt.fromI32(-1)
    sm.save()
  }

  return sm as BadgeStateManager
}

export function sharedInitialBadge(): Badge {
  let badge = Badge.load("1")
  if (badge === null) {
    badge = new Badge("1")
    badge.name = "Winter"
    badge.deltaTWAP = BigDecimal.fromString("-0.05")
    badge.minimumStreak = BigInt.fromI32(3)
    badge.currentStreak = BigInt.fromI32(0)
    badge.startTimestamp = BigInt.fromI32(1588530377 / 86400)
    badge.endTimestamp = BigInt.fromI32(-1)
    badge.save()
  }

  return badge as Badge
}

export function dayIDFromEvent(event: EthereumEvent, token: Token): string {
  return dayIDDaysBack(event, token, BigInt.fromI32(0))
}

function dayIDDaysBack(event: EthereumEvent, token: Token, daysBack: BigInt): string {
  let timestamp = event.block.timestamp.toI32()
  let dayID = (timestamp / 86400) - daysBack.toI32()
  let tokenDayID = token.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  return tokenDayID
}

export function daysBackFromDay(day: BigInt, daysBack: BigInt): BigInt {
  return day.minus(daysBack.times(BigInt.fromI32(86400)))
}

export function updateDailyBadgeStreaks(event: EthereumEvent, token: Token): void {
  // only update for WETH
  if (token.id != ADDRESS_WETH) {
    return
  }

  // check if we've already updated for this day
  let dayTimeStamp = event.block.timestamp.toI32() / 86400
  let sm = sharedBadgeStateManager()
  if (dayTimeStamp <= sm.lastBadgeUpdateTimestamp.toI32()) {
    return
  }

  let prevDayID = dayIDDaysBack(event, token, BigInt.fromI32(1))
  let previousDay = TokenDayData.load(prevDayID)
  let dayBeforePreviousDayID = dayIDDaysBack(event, token, BigInt.fromI32(2))
  let dayBeforePreviousDay = TokenDayData.load(dayBeforePreviousDayID)

  log.debug("comparing days {} : {}", [prevDayID, dayBeforePreviousDayID])
  if (previousDay != null && dayBeforePreviousDay != null) {
    let priceChange = changeInPrice(dayBeforePreviousDay.priceUSD, previousDay.priceUSD)
    let initialBadge = sharedInitialBadge()
    log.debug("yesterday's price: {} day before's price: {}\ncomparing price change: {} with delta: {}", [previousDay.priceUSD.toString(), dayBeforePreviousDay.priceUSD.toString(), priceChange.toString(), initialBadge.deltaTWAP.toString()])
    if (changeInPriceSatisfiesBadgeRequirement(priceChange, initialBadge.deltaTWAP)) {
      log.debug("adding 1 to streak", [])
      initialBadge.currentStreak = initialBadge.currentStreak.plus(BigInt.fromI32(1))
      initialBadge.save()
    }
    else if (initialBadge.currentStreak.ge(initialBadge.minimumStreak)) {
      log.debug("streak ended. creating claim period", [])

      // streak just finished, creat claim period
      createBadgeClaimPeriod(event, initialBadge)
      initialBadge.currentStreak = BigInt.fromI32(0)
      initialBadge.save()
    }
    else {
      log.debug("streak ended at {}", [initialBadge.currentStreak.toString()])
      initialBadge.currentStreak = BigInt.fromI32(0)
      initialBadge.save()
    }
  }
  else {
    log.debug("one of the days was null", [])
  }
}

function createBadgeClaimPeriod(event: EthereumEvent, badge: Badge): void {
  let claimPeriod = BadgeClaimPeriod.load(event.block.hash.toHexString())
  if (claimPeriod === null) {
    claimPeriod = new BadgeClaimPeriod(event.block.hash.toHexString())
    claimPeriod.endTimestamp = event.block.timestamp.div(BigInt.fromI32(86400))
    claimPeriod.startTimestamp = daysBackFromDay(claimPeriod.endTimestamp, badge.currentStreak)
    claimPeriod.streak = badge.currentStreak
    claimPeriod.badge = badge.id
    claimPeriod.save()
  }
}

function changeInPrice(price1: BigDecimal, price2: BigDecimal): BigDecimal {
  return (price1.minus(price2)).div(price1).times(BigDecimal.fromString("-1"))
}

function changeInPriceSatisfiesBadgeRequirement(priceChange: BigDecimal, badgeRequirement: BigDecimal): boolean {
  let satisfied = false

  if (badgeRequirement.gt(BigDecimal.fromString("0"))) {
    if (priceChange.gt(badgeRequirement)) {
      satisfied = true
    }
  }
  else {
    if (priceChange.lt(badgeRequirement)) {
      satisfied = true
    }
  }

  return satisfied
}