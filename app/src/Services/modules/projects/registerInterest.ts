/**
 * @file Posts new case of registered interest
 */
import { Config } from '@/Config'
import { EndpointBuilder } from '@reduxjs/toolkit/dist/query/endpointDefinitions'
import { ApiBaseQueryFunctionType } from '@/Services/api'
interface ProjectRegisterInterestQuery {
  project: {
    it_key: string
    res_id: string
  }
  user: {
    firstName: string
    lastName: string
    email: string
    happyToMentor: boolean
    lookingForBuddy: boolean
    availableFrom: string
  }
}

export type RegisterInterestResponseType = { data?: string; error?: string }

export default (
  build: EndpointBuilder<ApiBaseQueryFunctionType, never, 'api'>,
) =>
  build.query<{ data?: string; error?: string }, ProjectRegisterInterestQuery>({
    query: (query: ProjectRegisterInterestQuery) => ({
      url: `${Config.STA_BASE_URL}${Config.STA_API_VERSION}/projects/single/register-interest?it=${query.project.it_key}&res=${query.project.res_id}`,
      method: 'POST',
      body: query.user,
    }),
    transformResponse: (data: RegisterInterestResponseType) => data,
  })
