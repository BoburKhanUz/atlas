/** Small shared schemas: ids, text limits, weather snapshot. */
import { z } from 'zod'

export const idSchema = z.string().trim().min(1).max(64)
export const idParamsSchema = z.object({ id: idSchema })

/** Weather snapshot the client may send (all seven fields are what the engine uses). */
export const weatherSnapshotSchema = z.object({
  temperature: z.number().min(-90).max(70),
  feelsLike: z.number().min(-100).max(80),
  condition: z.string().trim().min(1).max(40),
  precipitationProbability: z.number().min(0).max(100),
  humidity: z.number().min(0).max(100),
  windSpeed: z.number().min(0).max(500),
  uvIndex: z.number().min(0).max(30),
})

/** Same fields, each optional (stylist chat accepts partial context). */
export const partialWeatherSchema = weatherSnapshotSchema.partial()
