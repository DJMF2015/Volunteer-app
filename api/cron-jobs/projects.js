require('dotenv').config();
const airTable = require('../helpers/airTable');
const arraysHelpers = require('../helpers/arrays');
const axios = require('axios').default;
const urlsHelpers = require('../helpers/urls');
const projectsHelpers = require('../helpers/projects');
const videosService = require('../services/videos');
const logging = require('../services/logging');
const api_key = process.env.JIRA_API_KEY;
const email = process.env.JIRA_EMAIL;
const resourcingJiraBoardName = 'RES';
const recruiterAssignedJiraColumnName = 'Recruiter Assigned';
const projectJiraBoardName = 'IT';
const volunteerSearch = 'Volunteer Search';
const volunteerIntroduction = 'Volunteer Introduction';
const activityUnderway = 'Activity Underway';

async function addNewProjectsResources(projectsResources) {
  // AirTable accepts creating records in groups of 10 (faster than doing just one record at at time),
  // so we chunk our data into an array of arrays, where each top-level array item is an array of up to 10 projects/resources

  const projectsResourcesChunked = arraysHelpers.chunk(projectsResources, 10);

  console.log('🛈 Saving project resources');
  for (const projectsResourcesChunk of projectsResourcesChunked) {
    await module.exports.addNewRecords(
      airTable.projectsResourcesCacheTable(),
      projectsResourcesChunk
    );
  }

  console.log('🛈 Finished saving new cache data');
}

async function addNewRecords(tableName, recordsChunk) {
  const recordsChunkFormattedForAirTable = recordsChunk.map((record) => ({
    fields: record,
  }));

  await airTable
    .client()
    .table(tableName)
    .create(recordsChunkFormattedForAirTable);
}

async function cacheProjectsAndResources(projects, resources) {
  if (!projects?.length || !resources?.length) {
    logging.logError(
      '❌ No projects/resources returned from Jira API, so aborted updating cache',
      {
        extraInfo: {
          projects,
          resources,
        },
      }
    );

    return;
  }

  console.log('🛈 Attempting to cache new data');

  const projectsResources = projectsHelpers.combineProjectsAndResources(
    projects,
    resources
  );

  try {
    await module.exports.deleteAllRecords(
      airTable.projectsResourcesCacheTable()
    );
  } catch (error) {
    logging.logError(
      '❌ Could not delete existing projects/resources records in cache, so aborted updating cache',
      {
        extraInfo: error,
      }
    );

    return;
  }

  try {
    await module.exports.addNewProjectsResources(projectsResources);
  } catch (error) {
    logging.logError(
      '❌ Could not save new projects/resources records in cache',
      {
        extraInfo: error,
      }
    );

    return;
  }

  console.log('🏁 Complete!');
}

async function deleteAllRecords(tableName) {
  console.log(`🛈 Deleting old records from ${tableName}`);

  return new Promise(async (resolve, reject) => {
    try {
      const allRecordsRaw = await airTable
        .client()
        .table(tableName)
        .select()
        .all();

      // AirTable accepts creating records in groups of 10 (faster than doing just one record at at time),
      // so we chunk our data into an array of arrays, where each top-level array item is an array of up to 10 records
      const allRecordsChunked = arraysHelpers.chunk(allRecordsRaw, 10);

      allRecordsChunked.forEach(async (recordsChunk) => {
        const recordIds = recordsChunk.map((record) => record.id);

        try {
          await module.exports.deleteRecords(tableName, recordIds);
        } catch (error) {
          logging.logError(
            `❌ Error deleting all records in table ${tableName}`,
            {
              extraInfo: error,
            }
          );

          reject();
        }
      });
    } catch (error) {
      console.error(error);
    }

    resolve();
  });
}

async function deleteRecords(tableName, recordIds) {
  return new Promise(async (resolve, reject) => {
    airTable
      .client()
      .table(tableName)
      .destroy(recordIds, (error) => {
        if (error) {
          logging.logError(`❌ AirTable delete error with table ${tableName}`, {
            extraInfo: error,
          });

          reject();
        }
        resolve();
      });
  });
}

function filterProjectsConnectedWithResources(itArray, resArray) {
  return itArray.filter((project) =>
    resArray.some((resource) => resource.it_key === project.it_key)
  );
}

function filterResourcesConnectedWithProjects(itArray, resArray) {
  return resArray.filter((resource) =>
    itArray.some((project) => project.it_key === resource.it_key)
  );
}

function formatProjects(projects, resources) {
  return projects.map((project) => {
    const resourcesConnectedToProject = resources.filter(
      (resource) => resource.it_key === project.it_key
    );
    const projectType = resourcesConnectedToProject.length
      ? resourcesConnectedToProject[0].type
      : '';

    return {
      ...project,
      type: projectType,
    };
  });
}

async function getAllProjectsAndResourcesFromJira() {
  console.log(
    '🛈 Getting data from Jira and Vimeo APIs - this can take 5 seconds or more'
  );

  return new Promise((resolve) => {
    const callAllItData = Promise.resolve(
      module.exports.getInitialTriageProjectsFromJira(0, [])
    );
    const callAllResData = Promise.resolve(
      module.exports.getResourcesFromJira(0, [])
    );

    Promise.all([callAllItData, callAllResData]).then((data) => {
      try {
        const itArray = data[0];
        const resArray = data[1];

        if (!itArray || !resArray)
          throw new Error(
            'Initial triage data or resource data returned as undefined'
          );

        const projectsFiltered =
          module.exports.filterProjectsConnectedWithResources(
            itArray,
            resArray
          );
        const resourcesFiltered =
          module.exports.filterResourcesConnectedWithProjects(
            itArray,
            resArray
          );
        const projectsFilteredAndFormatted = module.exports.formatProjects(
          projectsFiltered,
          resourcesFiltered
        );

        console.log(
          `🛈 Found ${projectsFilteredAndFormatted.length} projects matching resources, ${resourcesFiltered.length} resources matching projects`
        );

        resolve({
          projects: projectsFilteredAndFormatted,
          resources: resourcesFiltered,
        });
      } catch (error) {
        console.log(error);
        return;
      }
    });
  });
}

async function getInitialTriageProjectsFromJira(startAt, itArray) {
  const itJqlQuery = encodeURIComponent(
    `project=${projectJiraBoardName} AND status='${volunteerSearch}' OR status='${volunteerIntroduction}' OR status='${activityUnderway}'`
  );

  let jiraIt;
  try {
    jiraIt = await axios.get(
      `https://sta2020.atlassian.net/rest/api/2/search?jql=${itJqlQuery}&startAt=${startAt}&maxResults=1000`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            // below use email address you used for jira and generate token from jira
            `${email}:${api_key}`
          ).toString('base64')}`,
          Accept: 'application/json',
        },
      }
    );
    if (!jiraIt?.data?.issues?.length)
      throw new Error('Jira returned no initial triage projects');
  } catch (error) {
    console.error('While getting initial triage projects from Jira: ', error);
    return;
  }

  const itTotalData = parseInt(jiraIt.data.total);

  await Promise.all(
    jiraIt.data.issues.map(async (x) => {
      try {
        const project = {
          it_key: x['key'],
          name: x['fields'].summary,
          description: urlsHelpers.cleanUrlsAndEmails(
            x['fields'].description ?? ''
          ),
          client: x['fields'].customfield_10027,
          video_webpage: x['fields'].customfield_10159 ?? '',
          scope: x['fields'].customfield_10090,
          sector: x['fields'].customfield_10148?.value ?? '',
        };
        project.video_webpage_player_only =
          await videosService.getVideoWebpagePlayerOnly(project.video_webpage);

        itArray.push(project);
      } catch (error) {
        console.error(error);
      }
    })
  ).catch((error) => {
    console.error(error);
  });

  if (itArray.length < itTotalData) {
    const itStartResultSearch = itArray.length;
    return module.exports.getInitialTriageProjectsFromJira(
      itStartResultSearch,
      itArray
    );
  }
  return itArray;
}

async function getResourcesFromJira(startAt, resArray) {
  const resJqlQuery = encodeURIComponent(
    `project=${resourcingJiraBoardName} AND status='${recruiterAssignedJiraColumnName}'`
  );
  let jiraRes;
  try {
    jiraRes = await axios.get(
      `https://sta2020.atlassian.net/rest/api/2/search?jql=${resJqlQuery}&startAt=${startAt}&maxResults=1000`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            // below use email address you used for jira and generate token from jira
            `${email}:${api_key}`
          ).toString('base64')}`,
          Accept: 'application/json',
        },
      }
    );
    if (!jiraRes?.data?.issues?.length)
      throw new Error('Jira returned no resources');
  } catch (error) {
    console.error('While getting resources from Jira: ', error);
    return;
  }

  const resTotalData = parseInt(jiraRes.data.total);

  jiraRes.data.issues.map((x) =>
    resArray.push({
      res_id: x['id'],
      it_key: x['fields'].customfield_10109,
      type: x['fields'].customfield_10112,
      role: x['fields'].customfield_10113,
      skills: x['fields'].customfield_10061 ?? '',
      hours:
        x['fields'].customfield_10165?.value ??
        x['fields'].customfield_10062 ??
        '', // customfield_10165 is the newer field, customfield_10062 may not be needed in the future
      required: 1, // currently hardcoded as cannot see number of people coming back in Jira results
      buddying: x['fields'].customfield_10108
        ? x['fields'].customfield_10108.value.toLowerCase() === 'yes'
        : false,
    })
  );

  if (resArray.length < resTotalData) {
    const resStartResultSearch = resArray.length;

    return module.exports.getResourcesFromJira(resStartResultSearch, resArray);
  }

  return resArray;
}

async function startCachingLatestFromJira() {
  console.log(`🚀 Started caching projects and resources at ${new Date()}`);

  const allProjectsAndResources =
    await module.exports.getAllProjectsAndResourcesFromJira();
  module.exports.cacheProjectsAndResources(
    allProjectsAndResources.projects,
    allProjectsAndResources.resources
  );
}

module.exports = {
  addNewProjectsResources,
  addNewRecords,
  cacheProjectsAndResources,
  deleteAllRecords,
  deleteRecords,
  filterProjectsConnectedWithResources,
  filterResourcesConnectedWithProjects,
  formatProjects,
  getAllProjectsAndResourcesFromJira,
  getInitialTriageProjectsFromJira,
  getResourcesFromJira,
  startCachingLatestFromJira,
};
