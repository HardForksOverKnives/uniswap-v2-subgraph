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
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let tokenDayID = token.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  return tokenDayID
}

export function previousDayID(dayID: string): string {
  // let indexToSplit = dayID.search(dayID)
  let splitID = dayID.split("-")
  let previousDay = parseInt(dayID[0])
  previousDay = previousDay - 86400
  return previousDay.toString().concat(splitID[1])
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

  log.debug("updating badge streaks for previous day. token: {}", [token.name])

  let prevDayID = previousDayID(dayIDFromEvent(event, token))
  let previousDay = TokenDayData.load(prevDayID)
  let dayBeforePreviousDay = TokenDayData.load(previousDayID(prevDayID))
  if (previousDay != null && dayBeforePreviousDay != null) {
    let priceChange = changeInPrice(dayBeforePreviousDay.priceUSD, previousDay.priceUSD)
    let initialBadge = sharedInitialBadge()
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
      log.debug("streak ended", [])
      initialBadge.currentStreak = BigInt.fromI32(0)
      initialBadge.save()
    }
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
  return price1.div(price2).minus(BigDecimal.fromString("1").times(BigDecimal.fromString("-1")))
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