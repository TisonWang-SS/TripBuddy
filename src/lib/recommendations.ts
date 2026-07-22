import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { generateRecommendation } from "@/lib/decision";

export async function createRecommendationForBooking(bookingId: string) {
  const [profile, booking, observations, promotions] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { id: DEFAULT_PROFILE_ID },
      include: {
        loyaltyAccounts: true,
        creditCardBenefits: true
      }
    }),
    prisma.hotelBooking.findUnique({ where: { id: bookingId } }),
    prisma.priceObservation.findMany({ where: { bookingId } }),
    prisma.promotion.findMany()
  ]);

  if (!profile || !booking) {
    return null;
  }

  const loyaltyAccount = profile.loyaltyAccounts.find((account) => account.hotelGroup === booking.hotelGroup) ?? null;
  const loyaltyRule = loyaltyAccount
    ? await prisma.loyaltyRule.findUnique({
        where: {
          hotelGroup_tier: {
            hotelGroup: loyaltyAccount.hotelGroup,
            tier: loyaltyAccount.tier
          }
        }
      })
    : null;

  const decision = generateRecommendation({
    booking,
    observations,
    profile,
    loyaltyAccount,
    loyaltyRule,
    creditCards: profile.creditCardBenefits,
    promotions
  });

  return prisma.recommendation.create({
    data: {
      bookingId,
      candidateObservationId: decision.candidateObservationId,
      verdict: decision.verdict,
      estimatedSavings: decision.estimatedSavings,
      confidence: decision.confidence,
      cashDifference: decision.cashDifference,
      pointsValueDifference: decision.pointsValueDifference,
      promotionValueDifference: decision.promotionValueDifference,
      creditCardValueDifference: decision.creditCardValueDifference,
      eliteProgressDifference: decision.eliteProgressDifference,
      benefitValueDifference: decision.benefitValueDifference,
      explanation: decision.explanation
    }
  });
}
